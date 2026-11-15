import 'package:csv/csv.dart';
import '../muscle_load/muscle_load_service.dart';

/// Одна импортированная запись тренировки (плоская строка).
class ImportedSet {
  final DateTime date;
  final String exerciseName; // маппим на exercises по имени/алиасу
  final int? reps;
  final double? weight;
  final int? durationSeconds;
  const ImportedSet({
    required this.date,
    required this.exerciseName,
    this.reps,
    this.weight,
    this.durationSeconds,
  });
}

/// Описание, какая колонка CSV за что отвечает (у каждого приложения свой формат).
/// Пользователь выбирает маппинг в UI после предпросмотра заголовков.
class ColumnMapping {
  final String date;
  final String exercise;
  final String? reps;
  final String? weight;
  final String? duration;
  const ColumnMapping({
    required this.date,
    required this.exercise,
    this.reps,
    this.weight,
    this.duration,
  });
}

/// Импорт тренировок из CSV (выгрузка Lyfta или другого приложения).
///
/// 🔸 Точный формат выгрузки Lyfta неизвестен — поэтому маппинг колонок
/// настраиваемый. Логика парсинга отделена от файлового I/O ради тестов.
class WorkoutCsvImporter {
  /// Парсит уже прочитанный CSV-текст в список подходов по заданному маппингу.
  List<ImportedSet> parse(String csvText, ColumnMapping mapping) {
    final rows = const CsvToListConverter(
      shouldParseNumbers: false,
      eol: '\n',
    ).convert(csvText);
    if (rows.isEmpty) return [];

    final header = rows.first.map((e) => e.toString().trim()).toList();
    int col(String name) {
      final i = header.indexOf(name);
      if (i < 0) throw FormatException('Колонка "$name" не найдена в CSV');
      return i;
    }

    final dateIdx = col(mapping.date);
    final exIdx = col(mapping.exercise);
    final repsIdx = mapping.reps == null ? -1 : col(mapping.reps!);
    final weightIdx = mapping.weight == null ? -1 : col(mapping.weight!);
    final durIdx = mapping.duration == null ? -1 : col(mapping.duration!);

    final out = <ImportedSet>[];
    for (final row in rows.skip(1)) {
      if (row.isEmpty) continue;
      String? cell(int i) =>
          (i >= 0 && i < row.length) ? row[i].toString().trim() : null;

      final rawDate = cell(dateIdx);
      final name = cell(exIdx);
      if (rawDate == null || name == null || name.isEmpty) continue;
      final date = DateTime.tryParse(rawDate);
      if (date == null) continue; // пропускаем кривые строки, не падаем

      out.add(ImportedSet(
        date: date,
        exerciseName: name,
        reps: int.tryParse(cell(repsIdx) ?? ''),
        weight: double.tryParse(cell(weightIdx) ?? ''),
        durationSeconds: int.tryParse(cell(durIdx) ?? ''),
      ));
    }
    return out;
  }
}

/// Экспорт данных в CSV для анализа во внешнем проекте Claude.
class CsvExporter {
  /// Экспорт выполненных подходов. Колонки стабильны и самоописательны.
  String exportSets(List<ImportedSet> sets) {
    final rows = <List<dynamic>>[
      ['date', 'exercise', 'reps', 'weight_kg', 'duration_s'],
      for (final s in sets)
        [
          s.date.toIso8601String(),
          s.exerciseName,
          s.reps ?? '',
          s.weight ?? '',
          s.durationSeconds ?? '',
        ],
    ];
    return const ListToCsvConverter(eol: '\n').convert(rows);
  }

  /// Экспорт приёмов пищи.
  String exportNutrition(List<List<dynamic>> logRows) {
    final rows = <List<dynamic>>[
      ['datetime', 'food', 'brand', 'grams', 'kcal', 'protein', 'carbs', 'fat'],
      ...logRows,
    ];
    return const ListToCsvConverter(eol: '\n').convert(rows);
  }
}

/// Хелпер: превращает импортированные подходы в [CompletedSet] для расчёта
/// нагрузки, используя карту имя упражнения -> id.
List<CompletedSet> toCompletedSets(
  List<ImportedSet> imported,
  Map<String, int> exerciseNameToId,
) {
  final out = <CompletedSet>[];
  for (final s in imported) {
    final id = exerciseNameToId[s.exerciseName.toLowerCase()];
    if (id == null) continue; // неизвестное упражнение — пропускаем
    out.add(CompletedSet(
      exerciseId: id,
      reps: s.reps,
      weight: s.weight,
      durationSeconds: s.durationSeconds,
    ));
  }
  return out;
}
