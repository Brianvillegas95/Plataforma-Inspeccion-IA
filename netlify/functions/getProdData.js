// Archivo: netlify/functions/getProdData.js

// Función interna para procesar los datos del CSV.
const parseAndProcessData = (csvText) => {
    const rows = csvText.split(/\r?\n/).slice(1);
    return rows.map(row => {
        const columns = row.split(',');
        if (columns.length < 23) return null;

        const resource = columns[0].trim();
        const status = columns[21].trim();

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
    }).filter(Boolean);
};

// El handler principal que Netlify ejecuta.
exports.handler = async (event, context) => {
    // Importamos 'node-fetch' de forma dinámica.
    const fetch = (await import('node-fetch')).default;

    // ==================================================================
    // === ESTE ES EL CAMBIO MÁS IMPORTANTE ===
    
    // 1. Leemos solo el ID de la variable de entorno.
    const SHEET_ID = process.env.PRODUCTION_ORDERS_ID;

    // 2. Si no hay ID, lanzamos un error claro.
    if (!SHEET_ID) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'El ID de la hoja de cálculo no está configurado en la variable PRODUCTION_ORDERS_ID.' })
        };
    }

    // 3. Armamos la URL completa, igual que en tu otro dashboard.
    const GOOGLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?output=csv`;
    
    // ==================================================================

    try {
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
            body: JSON.stringify({ error: 'Hubo un fallo en el robot al procesar los datos.', details: error.message })
        };
    }
};