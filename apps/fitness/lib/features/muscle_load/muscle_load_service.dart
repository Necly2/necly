import '../../enums/muscle.dart';
import '../../enums/muscle_group.dart';
import '../../enums/muscle_role.dart';

/// Связь упражнения с мышцей и ролью (из exercise_muscles).
class MuscleInvolvement {
  final Muscle muscle;
  final MuscleRole role;
  const MuscleInvolvement(this.muscle, this.role);
}

/// Выполненный подход (из set_records). Объём = reps или длительность.
class CompletedSet {
  final int exerciseId;
  final int? reps;
  final double? weight; // кг, опционально
  final int? durationSeconds; // для упражнений на время
  const CompletedSet({
    required this.exerciseId,
    this.reps,
    this.weight,
    this.durationSeconds,
  });

  /// Объём одного подхода. Приоритет: reps(×weight) > время.
  /// Веса нет → считаем по повторам (bodyweight). Это настраиваемо.
  double get volume {
    if (reps != null) {
      final w = (weight != null && weight! > 0) ? weight! : 1.0;
      return reps! * w;
    }
    if (durationSeconds != null) {
      // 1 секунда статической/кардио работы ≈ 0.2 "повтора". Коэффициент настраиваемый.
      return durationSeconds! * 0.2;
    }
    return 0;
  }
}

/// 🔑 Сервис расчёта нагрузки на группы мышц.
///
/// Lyfta берёт за это деньги — здесь это бесплатно и считается из обычных данных:
/// для каждого выполненного подхода берём мышцы его упражнения, умножаем объём на
/// вес роли (основная/вспомогательная) и суммируем по группам мышц.
class MuscleLoadService {
  /// Карта: exerciseId -> список его мышц. Берётся из БД (exercise_muscles).
  final Map<int, List<MuscleInvolvement>> exerciseMuscles;

  const MuscleLoadService(this.exerciseMuscles);

  /// Нагрузка по группам за переданный набор подходов.
  /// Возвращает очки нагрузки по каждой группе (0 для отсутствующих).
  Map<MuscleGroup, double> loadByGroup(Iterable<CompletedSet> sets) {
    final result = {for (final g in MuscleGroup.values) g: 0.0};
    for (final set in sets) {
      final muscles = exerciseMuscles[set.exerciseId];
      if (muscles == null || muscles.isEmpty) continue;
      final vol = set.volume;
      for (final em in muscles) {
        final roleWeight = muscleRoleWeight[em.role]!;
        final group = groupOf(em.muscle);
        result[group] = result[group]! + vol * roleWeight;
      }
    }
    return result;
  }

  /// То же, но в процентах (доля каждой группы от суммарной нагрузки).
  /// Удобно для круговой/столбчатой диаграммы. Пустой ввод → всё по нулям.
  Map<MuscleGroup, double> loadDistribution(Iterable<CompletedSet> sets) {
    final raw = loadByGroup(sets);
    final total = raw.values.fold<double>(0, (a, b) => a + b);
    if (total == 0) return raw;
    return raw.map((g, v) => MapEntry(g, v / total * 100));
  }
}
