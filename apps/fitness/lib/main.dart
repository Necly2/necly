import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// Минимальная точка входа. Экраны (список тренировок, тренировка, нагрузка по
// мышцам, питание) добавляются в lib/features/*/screens/.
// Этот файл — заглушка каркаса, чтобы проект собирался. UI ещё не реализован.
void main() {
  runApp(const ProviderScope(child: NeclyFitnessApp()));
}

class NeclyFitnessApp extends StatelessWidget {
  const NeclyFitnessApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Necly Fitness',
      theme: ThemeData(colorSchemeSeed: Colors.teal, useMaterial3: true),
      home: const _Placeholder(),
    );
  }
}

class _Placeholder extends StatelessWidget {
  const _Placeholder();
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Necly Fitness')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Каркас проекта готов.\n\n'
            'Ядро реализовано и протестировано:\n'
            '• расчёт нагрузки по группам мышц\n'
            '• импорт/экспорт CSV\n'
            '• клиент Open Food Facts (штрих-код)\n'
            '• схема БД (drift/SQLite)\n\n'
            'UI-экраны — следующий шаг.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
