import 'dart:convert';
import 'package:http/http.dart' as http;

/// Упражнение из wger (нормализованное).
class WgerExercise {
  final int wgerId;
  final String name;
  final String? category;
  final List<int> primaryMuscleIds;
  final List<int> secondaryMuscleIds;
  const WgerExercise({
    required this.wgerId,
    required this.name,
    this.category,
    this.primaryMuscleIds = const [],
    this.secondaryMuscleIds = const [],
  });
}

/// Клиент wger API (wger.de). Публичные упражнения читаются без авторизации.
///
/// См. docs/RESEARCH.md. Офлайн-first стратегия: один раз выкачать нужные
/// упражнения, сохранить в assets/exercises.json, при первом запуске залить в БД.
/// 🔸 Маппинг muscleId wger → наш enum Muscle надо выверить по /api/v2/muscle/.
class WgerClient {
  final http.Client _http;
  final String userAgent;
  WgerClient({http.Client? httpClient, this.userAgent = 'NeclyFitness/0.1'})
      : _http = httpClient ?? http.Client();

  /// Полная инфа об упражнении (с мышцами). GET /exerciseinfo/<id>/.
  Future<WgerExercise?> fetchExerciseInfo(int id, {int languageId = 2}) async {
    final uri = Uri.parse('https://wger.de/api/v2/exerciseinfo/$id/');
    final resp = await _http.get(uri, headers: {'User-Agent': userAgent});
    if (resp.statusCode != 200) return null;
    final j = jsonDecode(resp.body) as Map<String, dynamic>;

    // Имя берём из перевода нужного языка.
    String name = 'Exercise $id';
    final translations = j['translations'];
    if (translations is List) {
      for (final t in translations) {
        if (t is Map && t['language'] == languageId && t['name'] is String) {
          name = t['name'] as String;
          break;
        }
      }
    }

    List<int> ids(dynamic list) => (list is List)
        ? list.whereType<Map>().map((m) => m['id'] as int).toList()
        : const [];

    return WgerExercise(
      wgerId: id,
      name: name,
      category: (j['category'] is Map) ? j['category']['name'] as String? : null,
      primaryMuscleIds: ids(j['muscles']),
      secondaryMuscleIds: ids(j['muscles_secondary']),
    );
  }

  void close() => _http.close();
}
