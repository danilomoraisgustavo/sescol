import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:setrane_desktop/main.dart';

void main() {
  testWidgets('desktop app loads login gateway', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const SetraneDesktopApp());
    await tester.pump(const Duration(seconds: 7));

    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.byType(Scaffold), findsWidgets);
  });
}
