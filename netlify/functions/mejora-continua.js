const { GoogleSpreadsheet } = require('google-spreadsheet');

exports.handler = async (event, context) => {
    // ID de tu hoja de cálculo (extráelo de la URL de tu Google Sheet)
    const SPREADSHEET_ID = process.env.MEJORA_CONTINUA_SHEET_ID; 
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID);

    try {
        // Autenticación usando variables de entorno de Netlify
        await doc.useServiceAccountAuth({
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        });

        await doc.loadInfo();

        // Función para extraer filas de una pestaña específica
        const getRowsData = async (sheetTitle) => {
            const sheet = doc.sheetsByTitle[sheetTitle];
            if (!sheet) return [];
            const rows = await sheet.getRows();
            return rows.map(row => {
                const data = {};
                sheet.headerValues.forEach(header => {
                    data[header] = row[header];
                });
                return data;
            });
        };

        // Leer las 6 hojas según tus especificaciones
        const [ajustes, bpp, adicionales, devoluciones, desperdicio, cinco_s] = await Promise.all([
            getRowsData('AJUSTE DE INVENTARIO'),
            getRowsData('BPP'),
            getRowsData('ADICIONALES'),
            getRowsData('DEVOLUCIONES'),
            getRowsData('DESPERDICIO'),
            getRowsData('5´S')
        ]);

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                data: {
                    ajustes,
                    bpp,
                    adicionales,
                    devoluciones,
                    desperdicio,
                    cinco_s
                }
            })
        };

    } catch (error) {
        console.error('Error en mejora-continua:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};