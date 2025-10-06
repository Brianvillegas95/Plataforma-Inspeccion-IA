// Archivo: netlify/functions/getProdData.js

const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

// Función para autenticarse con la API de Google Sheets
const authenticate = () => {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    // Reemplazamos los caracteres de escape '\\n' por saltos de línea reales '\n'
    const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

    if (!clientEmail || !privateKey) {
        throw new Error("Las credenciales de Google (CLIENT_EMAIL o PRIVATE_KEY) no están configuradas.");
    }

    const auth = new JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    return auth;
};

// El handler principal que Netlify ejecuta.
exports.handler = async (event, context) => {
    try {
        const spreadsheetId = process.env.PRODUCTION_SHEET_ID;
        // Asumimos que los datos están en una hoja llamada 'fnd_gfm_3335507' y cubren las columnas A hasta X.
        // ¡Ajusta este rango si tu hoja tiene otro nombre o más columnas!
        const range = 'fnd_gfm_3335507!A:X';

        if (!spreadsheetId) {
            throw new Error("El ID de la hoja de cálculo (PRODUCTION_SHEET_ID) no está configurado.");
        }

        const auth = authenticate();
        const sheets = google.sheets({ version: 'v4', auth });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify([])
            };
        }
        
        // El resto del código procesa los datos, igual que antes.
        // Omitimos la primera fila que es el encabezado.
        const header = rows[0];
        const dataRows = rows.slice(1);

        const processedData = dataRows.map(row => {
            const resource = row[0];
            const status = row[21];

            if (!resource || resource.startsWith('O') || status !== 'Released') {
                return null;
            }

            return {
                resource,
                department: row[3],
                requiredQty: parseFloat(row[8]) || 0,
                openQty: parseFloat(row[10]) || 0,
                startDate: new Date(row[13]).toISOString(),
                job: row[18],
                assembly: row[20],
                status,
                resourceDescription: row[23] || ''
            };
        }).filter(Boolean); // Limpia filas nulas

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(processedData)
        };

    } catch (error) {
        console.error("Error en la función de Netlify:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Hubo un fallo en el robot al autenticarse o leer la hoja.', details: error.message })
        };
    }
};