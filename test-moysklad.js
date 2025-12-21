// test-moysklad.js
// Тест: читаем товары из МойСклад и выводим в консоль

const { getProducts, getFrontendProducts } = require('./moysklad');

async function main() {
    try {
        console.log('Запрашиваем товары из МойСклад...');

        // Вариант 1: "сырые" товары
        const rawProducts = await getProducts(10);
        console.log(`Сырых товаров получено: ${rawProducts.length}`);

        // Вариант 2: подготовленные для фронта
        const products = await getFrontendProducts(10);
        console.log(`Подготовленных товаров: ${products.length}`);

        products.forEach((p, index) => {
            console.log('------------------------------');
            console.log(`№${index + 1}`);
            console.log('Имя:      ', p.name);
            console.log('Артикул:  ', p.article || '(нет)');
            console.log('Цена:     ', (typeof p.price === 'number') ? `${p.price} ₽` : 'не задана');
            console.log('ID:       ', p.id);
        });

        console.log('Готово.');
    } catch (err) {
        console.error('Тест завершился с ошибкой.');
    }
}

main();