import 'package:drift/drift.dart';
import '../enums/muscle.dart';
import '../enums/muscle_role.dart';

// Справочник упражнений (кэш из wger + свои).
class Exercises extends Table {
  IntColumn get id => integer().autoIncrement()();
  IntColumn get wgerId => integer().nullable()(); // ссылка на wger, если оттуда
  TextColumn get name => text()();
  TextColumn get category => text().nullable()();
  TextColumn get imageSlug => text().nullable()();
  BoolColumn get animated => boolean().withDefault(const Constant(false))();
}

// Какие мышцы задействует упражнение и в какой роли.
class ExerciseMuscles extends Table {
  IntColumn get exercise =>
      integer().references(Exercises, #id, onDelete: KeyAction.cascade)();
  IntColumn get muscle => intEnum<Muscle>()();
  IntColumn get role => intEnum<MuscleRole>()();
  @override
  Set<Column> get primaryKey => {exercise, muscle};
}

// Шаблон тренировки.
class Workouts extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get name => text()();
  TextColumn get category => text().nullable()();
}

// Состав шаблона тренировки.
class WorkoutExercises extends Table {
  IntColumn get id => integer().autoIncrement()();
  IntColumn get workout =>
      integer().references(Workouts, #id, onDelete: KeyAction.cascade)();
  IntColumn get exercise => integer().references(Exercises, #id)();
  IntColumn get order => integer()();
  IntColumn get targetDuration => integer().nullable()();
  IntColumn get targetReps => integer().nullable()();
}

// ФАКТ выполнения тренировки (что сделал). source: 'app' | 'lyfta_csv' | ...
class WorkoutRecords extends Table {
  IntColumn get id => integer().autoIncrement()();
  IntColumn get workout => integer().nullable().references(Workouts, #id)();
  DateTimeColumn get startedAt => dateTime()();
  DateTimeColumn get endedAt => dateTime().nullable()();
  TextColumn get source => text().withDefault(const Constant('app'))();
}

// ФАКТ отдельного подхода (как сделал).
class SetRecords extends Table {
  IntColumn get id => integer().autoIncrement()();
  IntColumn get workoutRecord =>
      integer().references(WorkoutRecords, #id, onDelete: KeyAction.cascade)();
  IntColumn get exercise => integer().references(Exercises, #id)();
  IntColumn get order => integer()();
  IntColumn get reps => integer().nullable()();
  RealColumn get weight => real().nullable()();
  IntColumn get durationSeconds => integer().nullable()();
}

// Продукты (кэш из Open Food Facts + ручные). source: 'openfoodfacts' | 'manual' | ...
class Foods extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get barcode => text().nullable()();
  TextColumn get name => text()();
  TextColumn get brand => text().nullable()();
  RealColumn get kcal100g => real().nullable()();
  RealColumn get protein100g => real().nullable()();
  RealColumn get carbs100g => real().nullable()();
  RealColumn get fat100g => real().nullable()();
  TextColumn get source => text().withDefault(const Constant('manual'))();
}

// ФАКТ приёма пищи (что съел).
class NutritionLogs extends Table {
  IntColumn get id => integer().autoIncrement()();
  IntColumn get food => integer().references(Foods, #id)();
  DateTimeColumn get loggedAt => dateTime()();
  RealColumn get grams => real()();
}
