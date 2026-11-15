import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
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
}
