// test-stock.js
// Отладочный скрипт: вытаскиваем сырые остатки МойСклад по складу и печатаем 1–2 строки

require('dotenv').config();
const axios = require('axios');

const token = process.env.MOYSKLAD_TOKEN;
const warehouseId = process.env.MOYSKLAD_WAREHOUSE_ID;
const apiBaseUrl = 'https://api.moysklad.ru/api/remap/1.2';

if (!token) {
    console.error('❌ Нет MOYSKLAD_TOKEN в .env');
    process.exit(1);
}

if (!warehouseId) {
    console.error('❌ Нет MOYSKLAD_WAREHOUSE_ID в .env');
    process.exit(1);
}

(async () => {
    try {
        const storeHref = `${apiBaseUrl}/entity/store/${warehouseId}`;
        const url = `${apiBaseUrl}/report/stock/all?filter=store=${storeHref}&limit=5`;

        console.log('Запрашиваем остатки по URL:');
        console.log(url);

        const res = await axios.get(url, {
            headers: {
                Authorization: 'Bearer ' + token,
                Accept: 'application/json;charset=utf-8'
            }
        });

        const rows = res.data.rows || [];
        console.log('Всего строк в ответе:', rows.length);

        if (rows[0]) {
            console.log('===== ROW[0] =====');
            console.log(JSON.stringify(rows[0], null, 2));
        } else {
            console.log('ROW[0] отсутствует');
        }

        if (rows[1]) {
            console.log('===== ROW[1] =====');
            console.log(JSON.stringify(rows[1], null, 2));
        } else {
            console.log('ROW[1] отсутствует');
        }
    } catch (error) {
        console.error('❌ Ошибка при запросе остатков:');
        if (error.response) {
            console.error('HTTP статус:', error.response.status);
            console.error('Тело ответа:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message || error);
        }
    }
})();