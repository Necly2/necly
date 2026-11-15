import 'package:test/test.dart';
import 'package:necly_fitness/enums/muscle.dart';
import 'package:necly_fitness/enums/muscle_group.dart';
import 'package:necly_fitness/enums/muscle_role.dart';
import 'package:necly_fitness/features/muscle_load/muscle_load_service.dart';

void main() {
  // Упражнение 1 (жим): грудь primary, трицепс/плечи secondary.
  // Упражнение 2 (присед): квадрицепс/ягодицы primary, кор secondary.
  final service = MuscleLoadService({
    1: const [
      ExerciseMuscle(Muscle.pectoralisMajor, MuscleRole.primary),
      ExerciseMuscle(Muscle.triceps, MuscleRole.secondary),
      ExerciseMuscle(Muscle.anteriorDeltoid, MuscleRole.secondary),
    ],
    2: const [
      ExerciseMuscle(Muscle.quadriceps, MuscleRole.primary),
      ExerciseMuscle(Muscle.gluteus, MuscleRole.primary),
      ExerciseMuscle(Muscle.rectusAbdominis, MuscleRole.secondary),
    ],
  });

  test('объём подхода считается по reps×weight', () {
    const set = CompletedSet(exerciseId: 1, reps: 10, weight: 50);
    expect(set.volume, 500);
  });

  test('bodyweight (без веса) считается по повторам', () {
    const set = CompletedSet(exerciseId: 1, reps: 20);
    expect(set.volume, 20);
  });

  test('нагрузка распределяется по группам с учётом роли', () {
    // Жим: 10 повторов × 50 кг = объём 500.
    const sets = [CompletedSet(exerciseId: 1, reps: 10, weight: 50)];
    final load = service.loadByGroup(sets);

    // грудь: 500 × 1.0 = 500
    expect(load[MuscleGroup.chest], 500);
    // руки (трицепс secondary): 500 × 0.5 = 250
    expect(load[MuscleGroup.arms], 250);
    // плечи (secondary): 500 × 0.5 = 250
    expect(load[MuscleGroup.shoulders], 250);
    // ноги не работали
    expect(load[MuscleGroup.legs], 0);
  });

  test('распределение в процентах суммируется к 100', () {
    const sets = [
      CompletedSet(exerciseId: 1, reps: 10, weight: 50),
      CompletedSet(exerciseId: 2, reps: 10, weight: 60),
    ];
    final dist = service.loadDistribution(sets);
    final total = dist.values.fold<double>(0, (a, b) => a + b);
    expect(total, closeTo(100, 1e-6));
  });

  test('неизвестное упражнение не ломает расчёт', () {
    const sets = [CompletedSet(exerciseId: 999, reps: 10)];
    final load = service.loadByGroup(sets);
    expect(load.values.every((v) => v == 0), isTrue);
  });
}
