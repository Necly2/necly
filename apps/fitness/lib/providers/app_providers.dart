import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../db/database.dart';
import '../enums/muscle_group.dart';
import '../features/muscle_load/muscle_load_service.dart';

/// Единственный экземпляр БД на всё приложение.
final databaseProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase();
  ref.onDispose(db.close);
  return db;
});

/// Список всех упражнений.
final exercisesProvider = FutureProvider((ref) {
  return ref.watch(databaseProvider).allExercises();
});

/// Недавние тренировки (для истории).
final historyProvider = FutureProvider((ref) {
  return ref.watch(databaseProvider).recentWorkoutRecords();
});

/// Период для диаграммы нагрузки (в днях). По умолчанию — неделя.
final loadPeriodDaysProvider = StateProvider<int>((ref) => 7);

/// Нагрузка на группы мышц за выбранный период (в процентах).
final muscleLoadProvider =
    FutureProvider<Map<MuscleGroup, double>>((ref) async {
  final db = ref.watch(databaseProvider);
  final days = ref.watch(loadPeriodDaysProvider);
  final since = DateTime.now().subtract(Duration(days: days));

  final muscleMap = await db.exerciseMuscleMap();
  final rows = await db.setsSince(since);
  final sets = rows.map((r) => CompletedSet(
        exerciseId: r.set.exercise,
        reps: r.set.reps,
        weight: r.set.weight,
        durationSeconds: r.set.durationSeconds,
      ));
  return MuscleLoadService(muscleMap).loadDistribution(sets);
});

/// Приёмы пищи за сегодня.
final todayNutritionProvider = FutureProvider((ref) {
  final since = DateTime.now().subtract(const Duration(hours: 24));
  return ref.watch(databaseProvider).nutritionSince(since);
});
