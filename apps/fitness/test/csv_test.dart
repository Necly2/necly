import 'package:test/test.dart';
import 'package:necly_fitness/features/import_export/csv_service.dart';

void main() {
  group('импорт CSV с настраиваемым маппингом', () {
    const mapping = ColumnMapping(
      date: 'Date',
      exercise: 'Exercise',
      reps: 'Reps',
      weight: 'Weight',
    );
    final importer = WorkoutCsvImporter();

    test('парсит валидные строки', () {
      const csv = 'Date,Exercise,Reps,Weight\n'
          '2026-11-10,Bench Press,10,50\n'
          '2026-11-10,Squat,8,80\n';
      final sets = importer.parse(csv, mapping);
      expect(sets.length, 2);
      expect(sets.first.exerciseName, 'Bench Press');
      expect(sets.first.reps, 10);
      expect(sets.first.weight, 50);
    });

    test('кривые строки пропускаются, не падаем', () {
      const csv = 'Date,Exercise,Reps,Weight\n'
          'not-a-date,Bench Press,10,50\n'
          '2026-11-10,,8,80\n' // пустое упражнение
          '2026-11-11,Squat,8,80\n';
      final sets = importer.parse(csv, mapping);
      expect(sets.length, 1);
      expect(sets.first.exerciseName, 'Squat');
    });

    test('отсутствие обязательной колонки → ошибка', () {
      const csv = 'Day,Exercise,Reps\n2026-11-10,Squat,8\n';
      expect(() => importer.parse(csv, mapping), throwsFormatException);
    });
  });

  group('экспорт', () {
    test('экспорт подходов содержит заголовок и строки', () {
      final exporter = CsvExporter();
      final out = exporter.exportSets([
        ImportedSet(
          date: DateTime.utc(2026, 11, 10),
          exerciseName: 'Squat',
          reps: 8,
          weight: 80,
        ),
      ]);
      expect(out, contains('date,exercise,reps,weight_kg,duration_s'));
      expect(out, contains('Squat'));
    });
  });

  test('маппинг импортированных имён на id упражнений', () {
    final imported = [
      ImportedSet(date: DateTime.utc(2026), exerciseName: 'Bench Press', reps: 10),
      ImportedSet(date: DateTime.utc(2026), exerciseName: 'Unknown', reps: 5),
    ];
    final sets = toCompletedSets(imported, {'bench press': 1});
    expect(sets.length, 1); // Unknown отброшен
    expect(sets.first.exerciseId, 1);
  });
}
