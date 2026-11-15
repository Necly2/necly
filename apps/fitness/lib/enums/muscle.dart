// Мышцы. Нумерация под wger (ориентировочно) — уточнить по /api/v2/muscle/.
// Используется в exercise_muscles. Хранится как int (индекс) в drift через intEnum.
enum Muscle {
  // грудь
  pectoralisMajor,
  // спина
  latissimusDorsi,
  trapezius,
  erectorSpinae,
  rhomboids,
  // плечи
  anteriorDeltoid,
  lateralDeltoid,
  posteriorDeltoid,
  // руки
  biceps,
  triceps,
  forearms,
  // ноги
  quadriceps,
  hamstrings,
  gluteus,
  calves,
  // кор
  rectusAbdominis,
  obliques,
}
