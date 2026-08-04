import 'package:flutter/material.dart';
import 'package:localsend_app/pages/receive_history_page.dart';
import 'package:localsend_app/provider/network/send_provider.dart';
import 'package:localsend_app/qlex/qlex_strings.dart';
import 'package:refena_flutter/refena_flutter.dart';
import 'package:routerino/routerino.dart';

class TransferQueuePage extends StatelessWidget {
  const TransferQueuePage({super.key});

  @override
  Widget build(BuildContext context) {
    final strings = QlexStrings.of(context);
    final sessions = context.watch(sendProvider).values.toList();
    return Scaffold(
      appBar: AppBar(
        title: Text(strings.transfers),
        actions: [
          IconButton(
            tooltip: strings.history,
            onPressed: () async => context.push(() => const ReceiveHistoryPage()),
            icon: const Icon(Icons.history_rounded),
          ),
        ],
      ),
      body: sessions.isEmpty
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.swap_horiz_rounded, size: 52, color: Theme.of(context).colorScheme.primary),
                  const SizedBox(height: 12),
                  Text(strings.noTransfers, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 16),
                  OutlinedButton.icon(
                    onPressed: () async => context.push(() => const ReceiveHistoryPage()),
                    icon: const Icon(Icons.history_rounded),
                    label: Text(strings.openHistory),
                  ),
                ],
              ),
            )
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: sessions.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final session = sessions[index];
                return Card(
                  child: ListTile(
                    leading: CircleAvatar(backgroundColor: Theme.of(context).colorScheme.primaryContainer, child: const Icon(Icons.devices_rounded)),
                    title: Text(session.target.alias),
                    subtitle: Text('${session.files.length} · ${session.status.name}'),
                  ),
                );
              },
            ),
    );
  }
}
