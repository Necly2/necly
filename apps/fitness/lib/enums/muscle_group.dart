import 'muscle.dart';

/// Группы мышц — крупные категории, по которым показываем нагрузку.
enum MuscleGroup { chest, back, shoulders, arms, legs, core }

/// Отображение конкретной мышцы в её группу.
const Map<Muscle, MuscleGroup> muscleToGroup = {
  Muscle.pectoralisMajor: MuscleGroup.chest,
  Muscle.latissimusDorsi: MuscleGroup.back,
  Muscle.trapezius: MuscleGroup.back,
  Muscle.erectorSpinae: MuscleGroup.back,
  Muscle.rhomboids: MuscleGroup.back,
  Muscle.anteriorDeltoid: MuscleGroup.shoulders,
  Muscle.lateralDeltoid: MuscleGroup.shoulders,
  Muscle.posteriorDeltoid: MuscleGroup.shoulders,
  Muscle.biceps: MuscleGroup.arms,
  Muscle.triceps: MuscleGroup.arms,
  Muscle.forearms: MuscleGroup.arms,
  Muscle.quadriceps: MuscleGroup.legs,
  Muscle.hamstrings: MuscleGroup.legs,
  Muscle.gluteus: MuscleGroup.legs,
  Muscle.calves: MuscleGroup.legs,
  Muscle.rectusAbdominis: MuscleGroup.core,
  Muscle.obliques: MuscleGroup.core,
};

MuscleGroup groupOf(Muscle m) => muscleToGroup[m]!;
