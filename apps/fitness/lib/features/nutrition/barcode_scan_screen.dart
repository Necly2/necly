import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Экран сканера штрих-кода. Возвращает строку штрих-кода через Navigator.pop.
class BarcodeScanScreen extends StatefulWidget {
  const BarcodeScanScreen({super.key});
  @override
  State<BarcodeScanScreen> createState() => _BarcodeScanScreenState();
}

class _BarcodeScanScreenState extends State<BarcodeScanScreen> {
  bool _handled = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Сканируй штрих-код')),
      body: MobileScanner(
        onDetect: (capture) {
          if (_handled) return;
          if (capture.barcodes.isEmpty) return;
          final code = capture.barcodes.first.rawValue;
          if (code == null || code.isEmpty) return;
          _handled = true;
          Navigator.of(context).pop(code);
        },
      ),
    );
  }
}
