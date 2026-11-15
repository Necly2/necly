import 'package:drift/drift.dart' show Value;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../db/database.dart';
import '../../db/tables.dart';
import '../../providers/app_providers.dart';
import 'barcode_scan_screen.dart';
import 'food_lookup_service.dart';
import 'open_food_facts_client.dart';

/// Провайдер сервиса поиска продуктов (Open Food Facts + fallback).
final foodLookupProvider = Provider<FoodLookupService>((ref) {
  final client = OpenFoodFactsClient();
  ref.onDispose(client.close);
  return FoodLookupService([OffSource(client)]);
});

/// Экран питания: скан штрих-кода → поиск → лог; список за сегодня.
class NutritionScreen extends ConsumerWidget {
  const NutritionScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final today = ref.watch(todayNutritionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Питание')),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.qr_code_scanner),
        label: const Text('Сканировать'),
        onPressed: () => _scanAndLog(context, ref),
      ),
      body: today.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Ошибка: $e')),
        data: (logs) {
          final totalKcal = logs.fold<double>(0, (sum, r) {
            final k = r.food.kcal100g;
            return k == null ? sum : sum + k * r.log.grams / 100;
          });
          return Column(
            children: [
              Card(
                margin: const EdgeInsets.all(12),
                child: ListTile(
                  title: const Text('Калории за сутки'),
                  trailing: Text('${totalKcal.toStringAsFixed(0)} ккал',
                      style: const TextStyle(fontSize: 18)),
                ),
              ),
              Expanded(
                child: logs.isEmpty
                    ? const Center(child: Text('Сегодня пусто. Отсканируй продукт.'))
                    : ListView.builder(
                        itemCount: logs.length,
                        itemBuilder: (_, i) {
                          final r = logs[i];
                          return ListTile(
                            title: Text(r.food.name),
                            subtitle: Text(
                                '${r.log.grams.toStringAsFixed(0)} г'
                                '${r.food.brand != null ? ' · ${r.food.brand}' : ''}'),
                          );
                        },
                      ),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _scanAndLog(BuildContext context, WidgetRef ref) async {
    final barcode = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const BarcodeScanScreen()),
    );
    if (barcode == null || !context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    final result = await ref.read(foodLookupProvider).lookup(barcode);

    if (!result.found) {
      // Продукт не найден ни в одном источнике → ручной ввод (здесь — заглушка).
      messenger.showSnackBar(SnackBar(
        content: Text('Продукт $barcode не найден. '
            'Источники: ${result.triedSources.join(', ')}. '
            'Добавь вручную (TODO).'),
      ));
      return;
    }

    final p = result.product!;
    if (!context.mounted) return;
    final grams = await _askGrams(context, p.name);
    if (grams == null) return;

    final db = ref.read(databaseProvider);
    final foodId = await db.upsertFood(FoodsCompanion.insert(
      name: p.name,
      barcode: Value(p.barcode),
      brand: Value(p.brand),
      kcal100g: Value(p.kcal100g),
      protein100g: Value(p.protein100g),
      carbs100g: Value(p.carbs100g),
      fat100g: Value(p.fat100g),
      source: Value(p.source),
    ));
    await db.logFood(foodId: foodId, grams: grams);
    ref.invalidate(todayNutritionProvider);
  }

  Future<double?> _askGrams(BuildContext context, String name) async {
    final ctrl = TextEditingController(text: '100');
    return showDialog<double>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(name),
        content: TextField(
          controller: ctrl,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Граммы'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Отмена')),
          FilledButton(
              onPressed: () =>
                  Navigator.pop(context, double.tryParse(ctrl.text)),
              child: const Text('Добавить')),
        ],
      ),
    );
  }
}
