import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../enums/muscle_group.dart';
import '../../providers/app_providers.dart';

/// 🔑 Экран нагрузки на группы мышц (в Lyfta — платно, тут бесплатно).
/// Простые горизонтальные бары без сторонних chart-библиотек.
class MuscleLoadScreen extends ConsumerWidget {
  const MuscleLoadScreen({super.key});

  static const _labels = {
    MuscleGroup.chest: 'Грудь',
    MuscleGroup.back: 'Спина',
    MuscleGroup.shoulders: 'Плечи',
    MuscleGroup.arms: 'Руки',
    MuscleGroup.legs: 'Ноги',
    MuscleGroup.core: 'Кор',
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final days = ref.watch(loadPeriodDaysProvider);
    final loadAsync = ref.watch(muscleLoadProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Нагрузка по мышцам')),
      body: Column(
        children: [
          _PeriodSelector(
            days: days,
            onChanged: (d) =>
                ref.read(loadPeriodDaysProvider.notifier).state = d,
          ),
          Expanded(
            child: loadAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('Ошибка: $e')),
              data: (dist) {
                final total = dist.values.fold<double>(0, (a, b) => a + b);
                if (total == 0) {
                  return const Center(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        'Пока нет данных за период.\n'
                        'Залогируй тренировку — и здесь появится распределение.',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  );
                }
                final entries = dist.entries.toList()
                  ..sort((a, b) => b.value.compareTo(a.value));
                return ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    for (final e in entries)
                      _LoadBar(
                        label: _labels[e.key]!,
                        percent: e.value,
                      ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _PeriodSelector extends StatelessWidget {
  final int days;
  final ValueChanged<int> onChanged;
  const _PeriodSelector({required this.days, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: SegmentedButton<int>(
        segments: const [
          ButtonSegment(value: 7, label: Text('Неделя')),
          ButtonSegment(value: 30, label: Text('Месяц')),
          ButtonSegment(value: 90, label: Text('3 мес')),
        ],
        selected: {days},
        onSelectionChanged: (s) => onChanged(s.first),
      ),
    );
  }
}

class _LoadBar extends StatelessWidget {
  final String label;
  final double percent;
  const _LoadBar({required this.label, required this.percent});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
              Text('${percent.toStringAsFixed(0)}%'),
            ],
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(
              value: (percent / 100).clamp(0.0, 1.0),
              minHeight: 12,
            ),
          ),
        ],
      ),
    );
  }
}
