// Archivo: netlify/functions/getProdData.js

const cheerio = require('cheerio'); // La nueva herramienta para leer HTML

// El handler principal que Netlify ejecuta.
exports.handler = async (event, context) => {
    // Importamos 'node-fetch' de forma dinámica para máxima compatibilidad.
    const fetch = (await import('node-fetch')).default;
    
    const SHEET_ID = process.env.PRODUCTION_ORDERS_ID;

    // Si no hay ID, lanzamos un error claro.
    if (!SHEET_ID) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'El ID de la hoja de cálculo no está configurado en la variable PRODUCTION_ORDERS_ID.' })
        };
    }

    // CAMBIO IMPORTANTE: La URL ahora apunta a la versión HTML de la hoja.
    const GOOGLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pubhtml`;

    try {
        const response = await fetch(GOOGLE_SHEET_URL);
        if (!response.ok) {
            throw new Error(`Error al contactar Google Sheets: ${response.status}`);
        }

        const htmlText = await response.text();
        const $ = cheerio.load(htmlText); // Cargamos el HTML en nuestra nueva herramienta.

        const processedData = [];
        // Buscamos todas las filas <tr> dentro del cuerpo <tbody> de la tabla.
        $('tbody tr').each((index, element) => {
            // Saltamos la primera fila si es parte del encabezado congelado
            if (index === 0) return;

            // Extraemos el texto de cada celda <td> en un array.
            const cells = $(element).find('td').map((i, cell) => $(cell).text()).get();

            // Si la fila no tiene suficientes columnas, la ignoramos.
            if (cells.length < 22) return;
            
            // Mapeamos los datos por la posición de su columna.
            const resource = cells[0];
            const status = cells[21];

            // Aplicamos las mismas reglas de filtrado de antes.
            if (!resource || resource.startsWith('O') || status !== 'Released') {
                return;
            }

            // Construimos el objeto con los datos extraídos.
            processedData.push({
                resource,
                department: cells[3],
                requiredQty: parseFloat(cells[8]) || 0,
                openQty: parseFloat(cells[10]) || 0,
                startDate: new Date(cells[13]).toISOString(),
                job: cells[18],
                assembly: cells[20],
                status,
                resourceDescription: cells[23] || ''
            });
        });

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