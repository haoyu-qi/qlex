import 'dart:io';

import 'package:desktop_drop/desktop_drop.dart';
import 'package:flutter/material.dart';
import 'package:localsend_app/config/init.dart';
import 'package:localsend_app/pages/home_page_controller.dart';
import 'package:localsend_app/pages/radar/radar_home_page.dart';
import 'package:localsend_app/provider/network/scan_facade.dart';
import 'package:localsend_app/provider/selection/selected_sending_files_provider.dart';
import 'package:localsend_app/util/native/cross_file_converters.dart';
import 'package:refena_flutter/refena_flutter.dart';

/// Retained for internal navigation compatibility with the upstream code.
/// qlex renders one unified radar window regardless of the requested legacy tab.
enum HomeTab { receive, send, settings }

class HomePage extends StatefulWidget {
  final HomeTab initialTab;
  final bool appStart;

  const HomePage({required this.initialTab, required this.appStart, super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> with Refena {
  bool _dragActive = false;

  @override
  void initState() {
    super.initState();
    ensureRef((ref) async {
      ref.redux(homePageControllerProvider).dispatch(ChangeTabAction(widget.initialTab));
      await postInit(context, ref, widget.appStart);
      await ref.global.dispatchAsync(StartSmartScan(forceLegacy: false));
    });
  }

  @override
  Widget build(BuildContext context) {
    return DropTarget(
      onDragEntered: (_) => setState(() => _dragActive = true),
      onDragExited: (_) => setState(() => _dragActive = false),
      onDragDone: (event) async {
        setState(() => _dragActive = false);
        if (event.files.length == 1 && Directory(event.files.first.path).existsSync()) {
          await ref.redux(selectedSendingFilesProvider).dispatchAsync(AddDirectoryAction(event.files.first.path));
        } else {
          await ref
              .redux(selectedSendingFilesProvider)
              .dispatchAsync(AddFilesAction(files: event.files, converter: CrossFileConverters.convertXFile));
        }
      },
      child: RadarHomePage(dragActive: _dragActive),
    );
  }
}
