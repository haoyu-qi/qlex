import 'package:flutter/material.dart';

class LocalSendLogo extends StatelessWidget {
  final bool withText;

  const LocalSendLogo({required this.withText});

  @override
  Widget build(BuildContext context) {
    final logo = Image.asset('assets/img/qlex-mark.png', width: 200, height: 200, filterQuality: FilterQuality.high);

    if (withText) {
      return Column(
        children: [
          logo,
          const Text(
            'qlex',
            style: TextStyle(fontSize: 36, fontWeight: FontWeight.bold),
            textAlign: TextAlign.center,
          ),
        ],
      );
    } else {
      return logo;
    }
  }
}
