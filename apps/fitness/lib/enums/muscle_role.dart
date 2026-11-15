/// Роль мышцы в упражнении.
/// primary — основная (целевая), secondary — вспомогательная (стабилизатор/ассист).
enum MuscleRole { primary, secondary }

/// Вес роли при расчёте нагрузки. Настраиваемо.
const Map<MuscleRole, double> muscleRoleWeight = {
  MuscleRole.primary: 1.0,
  MuscleRole.secondary: 0.5,
};
