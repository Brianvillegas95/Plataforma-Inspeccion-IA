const { google } = require('googleapis');

// --- Configuración de Autenticación ---
function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

function getSheetsAPI(auth) {
  return google.sheets({ version: 'v4', auth });
}

// --- Handler Principal ---
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const spreadsheetId = process.env.CONFIGURACIONMAN_SHEET_ID;
    if (!spreadsheetId) throw new Error('El ID de la hoja de Configuración no está configurado.');

    const auth = getAuth();
    const sheets = getSheetsAPI(auth);

    // 1. Leemos todo el bloque desde A hasta E
    // A:Area, B:Maquina, C:Estacion, D:TieneComputadora, E:Soluciones
    const ranges = ['Hoja 1!A2:E'];

    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: spreadsheetId,
      ranges: ranges,
    });

    const valueRanges = response.data.valueRanges || [];
    const rawData = valueRanges[0]?.values || [];
    
    const structuredData = {};
    const maquinaConfig = {}; 
    const solucionesSet = new Set(); // Usamos un Set para evitar duplicados de soluciones

    // 2. Procesamos fila por fila
    for (const row of rawData) {
        const area = row[0] ? row[0].trim() : null;
        const maquina = row[1] ? row[1].trim() : null;
        const estacion = row[2] ? row[2].trim() : null;
        
        // --- CAMBIOS AQUÍ POR TU NUEVA ESTRUCTURA ---
        // Columna D (Índice 3) es TieneComputadora
        const tienePC = row[3] ? row[3].trim().toUpperCase() : 'SI'; 
        
        // Columna E (Índice 4) es Soluciones
        const solucion = row[4] ? row[4].trim() : null;

        // Guardamos Solución si existe en esta fila (independiente de la máquina)
        if (solucion) {
            solucionesSet.add(solucion);
        }

        if (!area || !maquina) continue;

        // A. Estructura de Árbol
        if (estacion) {
            if (!structuredData[area]) structuredData[area] = {};
            if (!structuredData[area][maquina]) structuredData[area][maquina] = [];
            if (!structuredData[area][maquina].includes(estacion)) {
                structuredData[area][maquina].push(estacion);
            }
        }

        // B. Mapa de Configuración (Maquina -> TienePC)
        if (!maquinaConfig[maquina]) {
            maquinaConfig[maquina] = tienePC;
        }
    }

    // Convertimos el Set de soluciones a Array y lo ordenamos
    const solucionesOrdenadas = Array.from(solucionesSet).sort();

    return {
      statusCode: 200,
      body: JSON.stringify({
        data: structuredData,
        soluciones: solucionesOrdenadas,
        maquinaConfig: maquinaConfig 
      }),
    };

  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error al cargar configuración.' }) };
  }
};