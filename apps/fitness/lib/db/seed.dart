import 'dart:convert';
import 'package:drift/drift.dart';
import 'package:flutter/services.dart' show rootBundle;
import '../enums/muscle.dart';
import '../enums/muscle_role.dart';
import 'database.dart';
import 'tables.dart';

/// Загрузка стартовой базы упражнений из assets/exercises.json в локальную БД.
///
/// Офлайн-first (как Feeel): данные выкачаны из wger API заранее и лежат в ассетах.
/// Вызывается один раз при первом запуске (когда таблица exercises пуста).
class ExerciseSeeder {
  final AppDatabase db;
  ExerciseSeeder(this.db);

  static const _muscleByName = {
    'pectoralisMajor': Muscle.pectoralisMajor,
    'latissimusDorsi': Muscle.latissimusDorsi,
    'trapezius': Muscle.trapezius,
    'erectorSpinae': Muscle.erectorSpinae,
    'rhomboids': Muscle.rhomboids,
    'anteriorDeltoid': Muscle.anteriorDeltoid,
    'lateralDeltoid': Muscle.lateralDeltoid,
    'posteriorDeltoid': Muscle.posteriorDeltoid,
    'biceps': Muscle.biceps,
    'triceps': Muscle.triceps,
    'forearms': Muscle.forearms,
    'quadriceps': Muscle.quadriceps,
    'hamstrings': Muscle.hamstrings,
    'gluteus': Muscle.gluteus,
    'calves': Muscle.calves,
    'rectusAbdominis': Muscle.rectusAbdominis,
    'obliques': Muscle.obliques,
  };

  /// Заполняет БД, если упражнений ещё нет. Безопасно вызывать на каждом старте.
  Future<void> seedIfEmpty() async {
    final existing =
        await (db.select(db.exercises)..limit(1)).getSingleOrNull();
    if (existing != null) return;

    final raw = await rootBundle.loadString('assets/exercises.json');
    final list = (jsonDecode(raw) as List).cast<Map<String, dynamic>>();

    // Вставляем по одному, т.к. нужен сгенерированный id упражнения для связей
    // мышц (336 строк — быстро, один раз за установку).
    await db.transaction(() async {
      for (final e in list) {
        final id = await db.into(db.exercises).insert(
              ExercisesCompanion.insert(
                name: e['name'] as String,
                wgerId: Value(e['wgerId'] as int?),
                category: Value(e['category'] as String?),
              ),
            );
        await _insertMuscles(id, e['primary'], MuscleRole.primary);
        await _insertMuscles(id, e['secondary'], MuscleRole.secondary);
      }
    });
  }

  Future<void> _insertMuscles(int exerciseId, dynamic names, MuscleRole role) async {
    if (names is! List) return;
    for (final n in names) {
      final muscle = _muscleByName[n as String];
      if (muscle == null) continue;
      await db.into(db.exerciseMuscles).insert(
            ExerciseMusclesCompanion.insert(
              exercise: exerciseId,
              muscle: muscle,
              role: role,
            ),
            mode: InsertMode.insertOrIgnore,
          );
    }
  }
}
