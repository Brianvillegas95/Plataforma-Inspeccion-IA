// Archivo: netlify/functions/getProdData.js

// Usamos 'node-fetch' para poder hacer peticiones desde la función.
// Debes instalarlo ejecutando: npm install node-fetch
const fetch = require('node-fetch');

// --- CONFIGURACIÓN ---
// ¡IMPORTANTE! Pega aquí el enlace .csv de tu hoja de cálculo de producción.
const GOOGLE_SHEET_URL = 'URL_DE_TU_CSV_DE_PRODUCCION_AQUI';

/**
 * Parsea el texto CSV y lo convierte en un array de objetos con la lógica de negocio.
 */
const parseAndProcessData = (csvText) => {
    const rows = csvText.split(/\r?\n/).slice(1);
    return rows.map(row => {
        const columns = row.split(',');
        if (columns.length < 23) return null;

        const resource = columns[0].trim();
        const status = columns[21].trim();

        // REGLAS DE FILTRADO DEL LADO DEL SERVIDOR:
        // 1. Omitir recursos que empiezan con 'O'.
        // 2. Mostrar solo órdenes con estado "Released".
        if (resource.startsWith('O') || status !== 'Released') {
            return null;
        }

        return {
            resource: resource,
            department: columns[3].trim(),
            requiredQty: parseFloat(columns[8]) || 0,
            openQty: parseFloat(columns[10]) || 0,
            // Enviamos la fecha como texto ISO para asegurar consistencia
            startDate: new Date(columns[13]).toISOString(), 
            job: columns[18].trim(),
            assembly: columns[20].trim(),
            status: status,
            resourceDescription: columns[23].trim()
        };
    }).filter(Boolean); // Elimina los elementos nulos
};

/**
 * El handler principal de la función de Netlify.
 */
exports.handler = async (event, context) => {
    try {
        if (!GOOGLE_SHEET_URL || GOOGLE_SHEET_URL === 'URL_DE_TU_CSV_DE_PRODUCCION_AQUI') {
            throw new Error("La URL de Google Sheets no está configurada en la función de Netlify.");
        }

        const response = await fetch(GOOGLE_SHEET_URL);
        if (!response.ok) {
            throw new Error(`Error al contactar Google Sheets. Estado: ${response.status}`);
        }
        
        const csvText = await response.text();
        const processedData = parseAndProcessData(csvText);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*' // Permite el acceso desde cualquier origen
            },
            body: JSON.stringify(processedData)
        };

    } catch (error) {
        console.error("Error en la función de Netlify:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'No se pudieron obtener los datos de producción.', details: error.message })
        };
    }
};