// Archivo: netlify/functions/getProdData.js

// Netlify ya incluye 'node-fetch', por eso no necesitas instalarlo.
const fetch = require('node-fetch');

// El handler que Netlify ejecuta.
exports.handler = async (event, context) => {
    
    // 1. Leemos el ID de la hoja desde las variables de Netlify.
    const SHEET_ID = process.env.PRODUCTION_ORDERS_ID;
    
    // 2. Definimos el nombre de la pestaña dentro de tu hoja.
    //    Basado en el nombre de tu archivo original, probablemente sea este.
    //    ¡Si tu pestaña se llama diferente, ajústalo aquí!
    const SHEET_NAME = 'fnd_gfm_3335507';

    // 3. Construimos la URL de descarga directa de CSV.
    const GOOGLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAME}`;

    try {
        if (!SHEET_ID) {
            throw new Error("El ID de la hoja (PRODUCTION_ORDERS_ID) no está configurado.");
        }

        const response = await fetch(GOOGLE_SHEET_URL);
        if (!response.ok) {
            throw new Error(`Error al descargar el CSV de Google: ${response.status}. Asegúrate que la hoja sea accesible para 'Cualquier persona con el enlace'.`);
        }

        const csvText = await response.text();
        
        // El resto del código procesa el texto CSV.
        const rows = csvText.replace(/"/g, '').split('\n').slice(1);
        const processedData = rows.map(row => {
            const columns = row.split(',');

            if (columns.length < 22) return null;

            const resource = columns[0];
            const status = columns[21];

            if (!resource || resource.startsWith('O') || status !== 'Released') {
                return null;
            }

            return {
                resource,
                department: columns[3],
                requiredQty: parseFloat(columns[8]) || 0,
                openQty: parseFloat(columns[10]) || 0,
                startDate: new Date(columns[13]).toISOString(),
                job: columns[18],
                assembly: columns[20],
                status,
                resourceDescription: columns[23] || ''
            };
        }).filter(Boolean);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(processedData)
        };

    } catch (error) {
        console.error("Error en la función:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Hubo un fallo en el robot.', details: error.message })
        };
    }
};