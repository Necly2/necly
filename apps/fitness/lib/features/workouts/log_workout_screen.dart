import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../db/database.dart';
import '../../providers/app_providers.dart';

/// Логирование тренировки: создаём запись, добавляем подходы (упражнение/повторы/вес).
class LogWorkoutScreen extends ConsumerStatefulWidget {
  const LogWorkoutScreen({super.key});
  @override
  ConsumerState<LogWorkoutScreen> createState() => _LogWorkoutScreenState();
}

class _LogWorkoutScreenState extends ConsumerState<LogWorkoutScreen> {
  int? _recordId;
  final List<String> _added = []; // краткое описание добавленных подходов

  Future<int> _ensureRecord() async {
    if (_recordId != null) return _recordId!;
    final db = ref.read(databaseProvider);
    _recordId = await db.startWorkoutRecord();
    return _recordId!;
  }

  @override
  Widget build(BuildContext context) {
    final exercises = ref.watch(exercisesProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Новая тренировка'),
        actions: [
          TextButton(
            onPressed: () async {
              if (_recordId != null) {
                await ref.read(databaseProvider).finishWorkoutRecord(_recordId!);
              }
              if (context.mounted) Navigator.of(context).pop();
            },
            child: const Text('Готово'),
          ),
        ],
      ),
      body: exercises.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Ошибка: $e')),
        data: (list) => Column(
          children: [
            if (_added.isNotEmpty)
              Container(
                width: double.infinity,
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                padding: const EdgeInsets.all(12),
                child: Text('Добавлено подходов: ${_added.length}\n${_added.join('\n')}'),
              ),
            Expanded(
              child: ListView.builder(
                itemCount: list.length,
                itemBuilder: (_, i) {
                  final ex = list[i];
                  return ListTile(
                    title: Text(ex.name),
                    subtitle: ex.category != null ? Text(ex.category!) : null,
                    trailing: const Icon(Icons.add_circle_outline),
                    onTap: () => _addSetDialog(ex),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _addSetDialog(Exercise ex) async {
    final repsCtrl = TextEditingController();
    final weightCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(ex.name),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: repsCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Повторы'),
            ),
            TextField(
              controller: weightCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Вес, кг (опц.)'),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Отмена')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Добавить')),
        ],
      ),
    );
    if (ok != true) return;

    final db = ref.read(databaseProvider);
    final recordId = await _ensureRecord();
    final reps = int.tryParse(repsCtrl.text);
    final weight = double.tryParse(weightCtrl.text);
    await db.addSet(
      workoutRecordId: recordId,
      exerciseId: ex.id,
      order: _added.length,
      reps: reps,
      weight: weight,
    );
    setState(() {
      _added.add('${ex.name}: ${reps ?? '-'}×${weight ?? 'bw'}');
    });
  }
}
