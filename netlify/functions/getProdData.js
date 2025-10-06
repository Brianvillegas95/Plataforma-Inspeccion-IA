// Archivo: netlify/functions/getProdData.js

// Lee la variable de entorno que creaste en Netlify.
const GOOGLE_SHEET_URL = process.env.PRODUCTION_ORDERS_ID;

// Función interna para procesar los datos del CSV.
const parseAndProcessData = (csvText) => {
    const rows = csvText.split(/\r?\n/).slice(1);
    return rows.map(row => {
        const columns = row.split(',');
        if (columns.length < 23) return null;

        const resource = columns[0].trim();
        const status = columns[21].trim();

        // Filtra operadores y órdenes que no están liberadas.
        if (resource.startsWith('O') || status !== 'Released') {
            return null;
        }

        return {
            resource,
            department: columns[3].trim(),
            requiredQty: parseFloat(columns[8]) || 0,
            openQty: parseFloat(columns[10]) || 0,
            startDate: new Date(columns[13]).toISOString(),
            job: columns[18].trim(),
            assembly: columns[20].trim(),
            status,
            resourceDescription: columns[23].trim()
        };
    }).filter(Boolean); // Limpia filas nulas.
};

// El handler principal que Netlify ejecuta.
exports.handler = async (event, context) => {
    // Esta técnica de importación dinámica resuelve la incompatibilidad
    // con la versión 3 de 'node-fetch' sin tocar package.json.
    const fetch = (await import('node-fetch')).default;

    try {
        if (!GOOGLE_SHEET_URL) {
            throw new Error("La variable de entorno PRODUCTION_ORDERS_ID no está configurada.");
        }

        const response = await fetch(GOOGLE_SHEET_URL);
        if (!response.ok) {
            throw new Error(`Error al contactar Google Sheets: ${response.status}`);
        }

        const csvText = await response.text();
        const processedData = parseAndProcessData(csvText);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(processedData)
        };

    } catch (error) {
        console.error("Error en la función de Netlify:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Hubo un fallo en el robot.', details: error.message })
        };
    }
};