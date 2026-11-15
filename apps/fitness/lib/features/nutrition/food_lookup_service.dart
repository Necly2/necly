import 'open_food_facts_client.dart';

/// Абстракция источника продуктов — чтобы добавлять fallback-источники
/// (USDA, Nutritionix, …) не меняя логику цепочки.
abstract class FoodSource {
  String get name;

  /// null — продукт не найден В ЭТОМ источнике (идём дальше по цепочке).
  /// бросок исключения — источник недоступен (идём дальше, но логируем).
  Future<FoodProduct?> lookup(String barcode);
}

class OffSource implements FoodSource {
  final OpenFoodFactsClient client;
  OffSource(this.client);
  @override
  String get name => 'openfoodfacts';
  @override
  Future<FoodProduct?> lookup(String barcode) => client.lookup(barcode);
}

/// Результат поиска по цепочке.
class LookupResult {
  final FoodProduct? product; // null => нигде не найдено, нужен ручной ввод
  final List<String> triedSources;
  final List<String> failedSources; // источники, которые были недоступны
  const LookupResult({
    required this.product,
    required this.triedSources,
    required this.failedSources,
  });

  bool get found => product != null;
}

/// Ищет продукт по цепочке источников (решает проблему региональных пробелов OFF):
/// Open Food Facts → fallback-источники → (если нигде нет) ручной ввод в UI.
///
/// См. docs/RESEARCH.md: OFF силён в ЕС, но местами неполон; поэтому несколько
/// источников + возможность добавить продукт руками.
class FoodLookupService {
  final List<FoodSource> sources;

  FoodLookupService(this.sources);

  Future<LookupResult> lookup(String barcode) async {
    final tried = <String>[];
    final failed = <String>[];
    for (final source in sources) {
      tried.add(source.name);
      try {
        final product = await source.lookup(barcode);
        if (product != null) {
          return LookupResult(
            product: product,
            triedSources: tried,
            failedSources: failed,
          );
        }
      } catch (_) {
        failed.add(source.name); // недоступен — пробуем следующий
      }
    }
    return LookupResult(
      product: null, // UI должен предложить ручной ввод
      triedSources: tried,
      failedSources: failed,
    );
  }
}
