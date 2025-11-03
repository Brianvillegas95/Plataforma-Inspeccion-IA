const { google } = require('googleapis');

// --- Configuración de Autenticación (Reutilizada) ---
function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'], // .readonly es más seguro
  });
}

function getSheetsAPI(auth) {
  return google.sheets({ version: 'v4', auth });
}

// --- Handler Principal ---
exports.handler = async function (event) {
  
  // Solo permitimos peticiones GET
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID; // Usamos la misma variable de entorno
    if (!spreadsheetId) {
      throw new Error('El ID de la hoja de Mantenimiento no está configurado.');
    }

    const auth = getAuth();
    const sheets = getSheetsAPI(auth);

    // 1. Definimos los rangos que queremos leer de la pestaña "Configuracion"
    const ranges = [
      'Configuracion!A2:A', // Areas
      'Configuracion!B2:B', // Soluciones
      'Configuracion!C2:D'  // Maquinas y Estaciones
    ];

    // 2. Hacemos una llamada "batch" para traer todo de un solo golpe
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: spreadsheetId,
      ranges: ranges,
    });

    const valueRanges = response.data.valueRanges || [];

    // 3. Procesamos los datos recibidos

    // Procesar Areas (columna A)
    const areas = valueRanges[0]?.values?.flat().filter(Boolean) || []; // .flat() y .filter(Boolean) limpian la lista

    // Procesar Soluciones (columna B)
    const soluciones = valueRanges[1]?.values?.flat().filter(Boolean) || [];

    // Procesar Maquinas y Estaciones (columnas C y D)
    const maquinaData = valueRanges[2]?.values || [];
    const maquinas = {};

    for (const [maquina, estacion] of maquinaData) {
      if (!maquina || !estacion) continue; // Saltar filas vacías
      
      if (!maquinas[maquina]) {
        maquinas[maquina] = []; // Si es la primera vez que vemos la máquina, creamos su array
      }
      maquinas[maquina].push(estacion); // Agregamos la estación a la máquina
    }

    // 4. Devolvemos todo como un solo objeto JSON
    return {
      statusCode: 200,
      body: JSON.stringify({
        areas: areas,
        soluciones: soluciones,
        maquinas: maquinas, // Esto se verá como: {"EP02": ["Barril", "Punta", ...], ...}
      }),
    };

  } catch (error) {
    console.error('Error al leer la hoja de configuración:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'No se pudo cargar la configuración.' }),
    };
  }
};