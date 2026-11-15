import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;

/// Продукт, нормализованный под нашу БД (значения на 100 г).
class FoodProduct {
  final String barcode;
  final String name;
  final String? brand;
  final double? kcal100g;
  final double? protein100g;
  final double? carbs100g;
  final double? fat100g;
  final String source; // 'openfoodfacts', 'usda', 'manual', ...
  const FoodProduct({
    required this.barcode,
    required this.name,
    required this.source,
    this.brand,
    this.kcal100g,
    this.protein100g,
    this.carbs100g,
    this.fat100g,
  });
}

/// Клиент Open Food Facts.
///
/// Бесплатно, без ключа. Проверено (2026-11-15):
///   GET https://world.openfoodfacts.org/api/v2/product/<barcode>.json → 200.
/// Требует осмысленный User-Agent (имя приложения + контакт), иначе троттлят.
/// Иногда отдаёт 503 без закономерности → делаем ретраи с backoff.
class OpenFoodFactsClient {
  final http.Client _http;
  final String userAgent;
  final int maxRetries;

  OpenFoodFactsClient({
    http.Client? httpClient,
    this.userAgent = 'NeclyFitness/0.1 (personal learning project)',
    this.maxRetries = 3,
  }) : _http = httpClient ?? http.Client();

  static const _fields =
      'code,product_name,brands,nutriments,countries_tags';

  /// Ищет продукт по штрих-коду. Возвращает null, если продукт не найден в базе.
  /// Бросает [OffUnavailable], если сервис не отвечает (после ретраев).
  Future<FoodProduct?> lookup(String barcode) async {
    final uri = Uri.parse(
      'https://world.openfoodfacts.org/api/v2/product/$barcode.json'
      '?fields=$_fields',
    );

    http.Response? resp;
    for (var attempt = 0; attempt < maxRetries; attempt++) {
      try {
        resp = await _http.get(uri, headers: {'User-Agent': userAgent});
      } on SocketException {
        await _backoff(attempt);
        continue;
      }
      if (resp.statusCode == 503) {
        await _backoff(attempt); // известная болячка OFF — ретраим
        continue;
      }
      break;
    }

    if (resp == null) throw OffUnavailable(barcode);
    if (resp.statusCode == 404) return null;
    if (resp.statusCode == 503) throw OffUnavailable(barcode);
    if (resp.statusCode != 200) {
      throw OffUnavailable(barcode, status: resp.statusCode);
    }

    final body = jsonDecode(resp.body) as Map<String, dynamic>;
    // v2: status == 0 означает "product not found"
    if (body['status'] == 0) return null;
    final product = body['product'];
    if (product is! Map<String, dynamic>) return null;

    return _parse(barcode, product);
  }

  FoodProduct _parse(String barcode, Map<String, dynamic> p) {
    final n = (p['nutriments'] as Map?)?.cast<String, dynamic>() ?? const {};
    double? num100(String key) {
      final v = n['${key}_100g'] ?? n[key];
      if (v is num) return v.toDouble();
      return null;
    }

    final name = (p['product_name'] as String?)?.trim();
    return FoodProduct(
      barcode: barcode,
      name: (name == null || name.isEmpty) ? 'Unknown product' : name,
      brand: (p['brands'] as String?)?.trim(),
      kcal100g: num100('energy-kcal'),
      protein100g: num100('proteins'),
      carbs100g: num100('carbohydrates'),
      fat100g: num100('fat'),
      source: 'openfoodfacts',
    );
  }

  Future<void> _backoff(int attempt) =>
      Future.delayed(Duration(milliseconds: 300 * (attempt + 1)));

  void close() => _http.close();
}

/// Сервис недоступен (сеть/503). Отличается от "продукт не найден" (null).
class OffUnavailable implements Exception {
  final String barcode;
  final int? status;
  OffUnavailable(this.barcode, {this.status});
  @override
  String toString() =>
      'Open Food Facts unavailable for $barcode'
      '${status != null ? ' (HTTP $status)' : ''}';
}
