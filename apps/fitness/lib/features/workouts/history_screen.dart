import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/app_providers.dart';
import 'log_workout_screen.dart';

/// История тренировок (факты выполнения).
class HistoryScreen extends ConsumerWidget {
  const HistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(historyProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('История тренировок')),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.add),
        label: const Text('Тренировка'),
        onPressed: () async {
          await Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => const LogWorkoutScreen(),
          ));
          ref.invalidate(historyProvider);
          ref.invalidate(muscleLoadProvider);
        },
      ),
      body: history.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Ошибка: $e')),
        data: (records) {
          if (records.isEmpty) {
            return const Center(child: Text('Ещё нет тренировок. Нажми «Тренировка».'));
          }
          return ListView.builder(
            itemCount: records.length,
            itemBuilder: (_, i) {
              final r = records[i];
              final d = r.startedAt;
              return ListTile(
                leading: const Icon(Icons.fitness_center),
                title: Text('${d.day}.${d.month}.${d.year}'),
                subtitle: Text('Источник: ${r.source}'),
              );
            },
          );
        },
      ),
    );
  }
}
