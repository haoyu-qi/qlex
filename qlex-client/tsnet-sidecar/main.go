package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"tailscale.com/tsnet"
)

type PeerInfo struct {
	ID       string `json:"id"`
	HostName string `json:"hostName"`
	DNSName  string `json:"dnsName"`
	IP       string `json:"ip"`
	OS       string `json:"os"`
	Online   bool   `json:"online"`
	Relay    string `json:"relay"`
	CurAddr  string `json:"curAddr"`
	Direct   bool   `json:"direct"`
}

type StatusPayload struct {
	Event        string     `json:"event"`
	BackendState string     `json:"backendState"`
	Online       bool       `json:"online"`
	AuthURL      string     `json:"authURL,omitempty"`
	HostName     string     `json:"hostName,omitempty"`
	DNSName      string     `json:"dnsName,omitempty"`
	IPs          []string   `json:"ips,omitempty"`
	ListenPort   int        `json:"listenPort"`
	ControlPort  int        `json:"controlPort"`
	Peers        []PeerInfo `json:"peers"`
	Error        string     `json:"error,omitempty"`
}

var (
	statusMu     sync.RWMutex
	latestStatus StatusPayload
	stdoutMu     sync.Mutex
)

func emit(payload StatusPayload) {
	statusMu.Lock()
	latestStatus = payload
	statusMu.Unlock()

	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	stdoutMu.Lock()
	fmt.Println(string(b))
	stdoutMu.Unlock()
}

func proxyConn(dstAddr string, src net.Conn) {
	defer src.Close()
	dst, err := net.DialTimeout("tcp", dstAddr, 5*time.Second)
	if err != nil {
		return
	}
	defer dst.Close()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = io.Copy(dst, src)
		if tc, ok := dst.(*net.TCPConn); ok {
			_ = tc.CloseWrite()
		}
	}()
	go func() {
		defer wg.Done()
		_, _ = io.Copy(src, dst)
	}()
	wg.Wait()
}

func main() {
	hostname := flag.String("hostname", "qlex-node", "Tailnet node hostname")
	stateDir := flag.String("state-dir", "", "Directory for persistent tsnet state")
	listenPort := flag.Int("listen-port", 46271, "Port exposed inside Tailnet")
	targetAddr := flag.String("target", "127.0.0.1:46271", "Local QLEX center TLS address to forward to")
	controlPort := flag.Int("control-port", 0, "Local loopback HTTP status port (0 = ephemeral)")
	flag.Parse()

	dir := *stateDir
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, "Library", "Application Support", "QLEX", "tsnet-state")
	}
	_ = os.MkdirAll(dir, 0o700)

	srv := &tsnet.Server{
		Hostname: *hostname,
		Dir:      dir,
		AuthKey:  os.Getenv("QLEX_TSNET_AUTHKEY"),
		Logf:     func(format string, args ...any) {},
	}
	defer srv.Close()

	ctrlLn, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *controlPort))
	if err != nil {
		emit(StatusPayload{Event: "error", BackendState: "Stopped", Error: err.Error(), Peers: []PeerInfo{}})
		os.Exit(1)
	}
	actualCtrlPort := ctrlLn.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		statusMu.RLock()
		snap := latestStatus
		statusMu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(snap)
	})
	mux.HandleFunc("/shutdown", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		go func() {
			time.Sleep(100 * time.Millisecond)
			_ = srv.Close()
			os.Exit(0)
		}()
	})
	go func() {
		_ = http.Serve(ctrlLn, mux)
	}()

	emit(StatusPayload{
		Event:        "starting",
		BackendState: "Starting",
		HostName:     *hostname,
		ListenPort:   *listenPort,
		ControlPort:  actualCtrlPort,
		Peers:        []PeerInfo{},
	})

	if err := srv.Start(); err != nil {
		emit(StatusPayload{Event: "error", BackendState: "Stopped", ControlPort: actualCtrlPort, Error: err.Error(), Peers: []PeerInfo{}})
		os.Exit(1)
	}

	lc, err := srv.LocalClient()
	if err != nil {
		emit(StatusPayload{Event: "error", BackendState: "Stopped", ControlPort: actualCtrlPort, Error: err.Error(), Peers: []PeerInfo{}})
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Start Tailnet listener forwarding raw TLS traffic to local QLEX center
	go func() {
		ln, err := srv.Listen("tcp", fmt.Sprintf(":%d", *listenPort))
		if err != nil {
			return
		}
		defer ln.Close()
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go proxyConn(*targetAddr, conn)
		}
	}()

	pollStatus := func() {
		pctx, cancel := context.WithTimeout(ctx, 4*time.Second)
		defer cancel()
		st, err := lc.Status(pctx)
		if err != nil {
			return
		}
		var ips []string
		for _, ip := range st.TailscaleIPs {
			ips = append(ips, ip.String())
		}
		dnsName := ""
		selfHost := *hostname
		if st.Self != nil {
			dnsName = strings.TrimSuffix(st.Self.DNSName, ".")
			if st.Self.HostName != "" {
				selfHost = st.Self.HostName
			}
		}
		peers := make([]PeerInfo, 0, len(st.Peer))
		for _, p := range st.Peer {
			if p == nil {
				continue
			}
			ipStr := ""
			for _, addr := range p.TailscaleIPs {
				if addr.Is4() {
					ipStr = addr.String()
					break
				}
			}
			if ipStr == "" && len(p.TailscaleIPs) > 0 {
				ipStr = p.TailscaleIPs[0].String()
			}
			peers = append(peers, PeerInfo{
				ID:       string(p.ID),
				HostName: p.HostName,
				DNSName:  strings.TrimSuffix(p.DNSName, "."),
				IP:       ipStr,
				OS:       p.OS,
				Online:   p.Online,
				Relay:    p.Relay,
				CurAddr:  p.CurAddr,
				Direct:   p.CurAddr != "",
			})
		}
		sort.Slice(peers, func(i, j int) bool {
			if peers[i].Online != peers[j].Online {
				return peers[i].Online
			}
			return peers[i].HostName < peers[j].HostName
		})

		evt := "status"
		if st.AuthURL != "" {
			evt = "needs_login"
		} else if st.BackendState == "Running" {
			evt = "running"
		}
		emit(StatusPayload{
			Event:        evt,
			BackendState: st.BackendState,
			Online:       st.BackendState == "Running" && len(ips) > 0,
			AuthURL:      st.AuthURL,
			HostName:     selfHost,
			DNSName:      dnsName,
			IPs:          ips,
			ListenPort:   *listenPort,
			ControlPort:  actualCtrlPort,
			Peers:        peers,
		})
	}

	pollStatus()
	ticker := time.NewTicker(4 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pollStatus()
		}
	}
}
