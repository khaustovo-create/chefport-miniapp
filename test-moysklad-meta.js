// test-moysklad-meta.js
// Тест: выводим склады, типы цен и организации из МойСклад

const { getStores, getPriceTypes, getOrganizations } = require('./moysklad');

async function main() {
    try {
        console.log('=== СКЛАДЫ (store) ===');
        const stores = await getStores();
        console.log(`Найдено складов: ${stores.length}`);

        stores.forEach((s, index) => {
            console.log('------------------------------');
            console.log(`№${index + 1}`);
            console.log('Имя склада: ', s.name);
            console.log('ID склада:  ', s.id);
        });

        console.log('\n=== ТИПЫ ЦЕН (pricetype) ===');
        const priceTypes = await getPriceTypes();
        console.log(`Найдено типов цен: ${priceTypes.length}`);

        priceTypes.forEach((t, index) => {
            console.log('------------------------------');
            console.log(`№${index + 1}`);
            console.log('Имя типа цены: ', t.name);
            console.log('ID типа цены:  ', t.id);
        });

        console.log('\n=== ОРГАНИЗАЦИИ (organization) ===');
        const orgs = await getOrganizations();
        console.log(`Найдено организаций: ${orgs.length}`);

        orgs.forEach((o, index) => {
            console.log('------------------------------');
            console.log(`№${index + 1}`);
            console.log('Имя организации: ', o.name);
            console.log('ID организации:  ', o.id);
        });

        console.log('\nГотово.');
    } catch (err) {
        console.error('Тест завершился с ошибкой.');
    }
}

main();