import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import '../features/muscle_load/muscle_load_service.dart';
import 'tables.dart';

part 'database.g.dart'; // генерируется: dart run build_runner build

@DriftDatabase(tables: [
  Exercises,
  ExerciseMuscles,
  Workouts,
  WorkoutExercises,
  WorkoutRecords,
  SetRecords,
  Foods,
  NutritionLogs,
])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_open());

  @override
  int get schemaVersion => 1;

  static QueryExecutor _open() =>
      driftDatabase(name: 'necly_fitness'); // SQLite-файл в app documents

  // ---- Упражнения ----

  Future<List<Exercise>> allExercises() =>
      (select(exercises)..orderBy([(e) => OrderingTerm(expression: e.name)]))
          .get();

  Future<List<Exercise>> searchExercises(String query) {
    final q = '%${query.toLowerCase()}%';
    return (select(exercises)
          ..where((e) => e.name.lower().like(q))
          ..orderBy([(e) => OrderingTerm(expression: e.name)]))
        .get();
  }

  /// Карта exerciseId -> список участий мышц. Нужна [MuscleLoadService].
  Future<Map<int, List<MuscleInvolvement>>> exerciseMuscleMap() async {
    final rows = await select(exerciseMuscles).get();
    final map = <int, List<MuscleInvolvement>>{};
    for (final r in rows) {
      (map[r.exercise] ??= []).add(MuscleInvolvement(r.muscle, r.role));
    }
    return map;
  }

  // ---- Логирование тренировок ----

  /// Создаёт запись тренировки и возвращает её id.
  Future<int> startWorkoutRecord({int? workoutId, String source = 'app'}) {
    return into(workoutRecords).insert(WorkoutRecordsCompanion.insert(
      workout: Value(workoutId),
      startedAt: DateTime.now(),
      source: Value(source),
    ));
  }

  Future<void> finishWorkoutRecord(int recordId) {
    return (update(workoutRecords)..where((r) => r.id.equals(recordId)))
        .write(WorkoutRecordsCompanion(endedAt: Value(DateTime.now())));
  }

  Future<int> addSet({
    required int workoutRecordId,
    required int exerciseId,
    required int order,
    int? reps,
    double? weight,
    int? durationSeconds,
  }) {
    return into(setRecords).insert(SetRecordsCompanion.insert(
      workoutRecord: workoutRecordId,
      exercise: exerciseId,
      order: order,
      reps: Value(reps),
      weight: Value(weight),
      durationSeconds: Value(durationSeconds),
    ));
  }

  /// Все подходы с датой начала их тренировки, начиная с [since].
  Future<List<({SetRecord set, DateTime date})>> setsSince(DateTime since) async {
    final query = select(setRecords).join([
      innerJoin(workoutRecords,
          workoutRecords.id.equalsExp(setRecords.workoutRecord)),
    ])
      ..where(workoutRecords.startedAt.isBiggerOrEqualValue(since));
    final rows = await query.get();
    return rows
        .map((r) => (
              set: r.readTable(setRecords),
              date: r.readTable(workoutRecords).startedAt,
            ))
        .toList();
  }

  Future<List<WorkoutRecord>> recentWorkoutRecords({int limit = 50}) {
    return (select(workoutRecords)
          ..orderBy([
            (r) => OrderingTerm(expression: r.startedAt, mode: OrderingMode.desc)
          ])
          ..limit(limit))
        .get();
  }

  // ---- Питание ----

  /// Находит продукт по штрих-коду или создаёт новый. Возвращает id.
  Future<int> upsertFood(FoodsCompanion food) async {
    final bc = food.barcode.value;
    if (bc != null) {
      final existing = await (select(foods)..where((f) => f.barcode.equals(bc)))
          .getSingleOrNull();
      if (existing != null) return existing.id;
    }
    return into(foods).insert(food);
  }

  Future<int> logFood({required int foodId, required double grams}) {
    return into(nutritionLogs).insert(NutritionLogsCompanion.insert(
      food: foodId,
      loggedAt: DateTime.now(),
      grams: grams,
    ));
  }

  /// Приёмы пищи с данными продукта, начиная с [since].
  Future<List<({NutritionLog log, Food food})>> nutritionSince(
      DateTime since) async {
    final query = select(nutritionLogs).join([
      innerJoin(foods, foods.id.equalsExp(nutritionLogs.food)),
    ])
      ..where(nutritionLogs.loggedAt.isBiggerOrEqualValue(since))
      ..orderBy([
        OrderingTerm(expression: nutritionLogs.loggedAt, mode: OrderingMode.desc)
      ]);
    final rows = await query.get();
    return rows
        .map((r) =>
            (log: r.readTable(nutritionLogs), food: r.readTable(foods)))
        .toList();
  }
}
