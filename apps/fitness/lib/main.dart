import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'db/seed.dart';
import 'providers/app_providers.dart';
import 'features/workouts/history_screen.dart';
import 'features/muscle_load/muscle_load_screen.dart';
import 'features/nutrition/nutrition_screen.dart';

void main() {
  runApp(const ProviderScope(child: NeclyFitnessApp()));
}

/// Разовая инициализация: заполнить базу упражнений при первом запуске.
final _seedProvider = FutureProvider<void>((ref) async {
  final db = ref.watch(databaseProvider);
  await ExerciseSeeder(db).seedIfEmpty();
});

class NeclyFitnessApp extends StatelessWidget {
  const NeclyFitnessApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Necly Fitness',
      theme: ThemeData(colorSchemeSeed: Colors.teal, useMaterial3: true),
      home: const _Root(),
    );
  }
}

class _Root extends ConsumerWidget {
  const _Root();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final seed = ref.watch(_seedProvider);
    return seed.when(
      loading: () =>
          const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (e, _) =>
          Scaffold(body: Center(child: Text('Ошибка инициализации: $e'))),
      data: (_) => const HomeShell(),
    );
  }
}

/// Нижняя навигация между тремя разделами.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;
  static const _screens = [
    HistoryScreen(),
    MuscleLoadScreen(),
    NutritionScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _screens[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.history), label: 'Тренировки'),
          NavigationDestination(
              icon: Icon(Icons.pie_chart_outline), label: 'Нагрузка'),
          NavigationDestination(
              icon: Icon(Icons.restaurant), label: 'Питание'),
        ],
      ),
    );
  }
}
