const { google } = require('googleapis');

/**
 * Esta es la función principal que Netlify ejecutará.
 * Se activa cuando visitas la URL '/.netlify/functions/leer-prod-data'.
 */
exports.handler = async (event) => {
  try {
    // 1. OBTENER EL ID DE LA HOJA
    // Leemos el ID de tu hoja de Google desde las variables de entorno de Netlify.
    // Es importante que la variable 'PRODUCTION_ORDERS_ID' esté creada en tu sitio de Netlify.
    const hojaId = process.env.PRODUCTION_ORDERS_ID;
    if (!hojaId) {
      throw new Error('El ID de la hoja de cálculo de Producción no está configurado en Netlify.');
    }

    // 2. DEFINIR EL RANGO DE DATOS
    // Especificamos que queremos leer desde la celda A1 hasta la columna J de la "Hoja 1".
    // Esto debería cubrir todas tus columnas: Resource, UOM, ..., Assigned Date.
    const rango = 'Hoja 1!A:J'; 

    // 3. AUTENTICACIÓN SEGURA
    // Usamos las credenciales de la cuenta de servicio (tu robot) que también están en Netlify.
    // Esto permite que nuestra función acceda a la hoja de forma segura sin exponer contraseñas.
    const credentials = {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // 4. LEER LOS DATOS DE LA HOJA
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: hojaId,
      range: rango,
    });
    
    const rows = response.data.values;

    if (!rows || rows.length <= 1) {
      // Si la hoja está vacía o solo tiene encabezados, devolvemos un arreglo vacío.
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([]),
      };
    }

    // 5. TRANSFORMAR LOS DATOS A JSON
    // El HTML espera objetos con nombres de propiedad (ej: job, resource).
    // La API de Google nos da un arreglo de arreglos (filas y columnas).
    // Este código transforma los datos al formato que necesitamos.
    const headers = rows[0].map(h => h.replace(/\s+/g, '')); // ["Resource", "RequiredQuantit", ...]
    const data = rows.slice(1).map(row => {
      // Por cada fila de datos, creamos un objeto.
      return {
        resource: row[0] || '',
        department: row[3] || '',
        assembly: row[4] || '', // Mapeamos 'Item' a 'assembly'
        job: row[5] || '',
        requiredQty: parseFloat(row[6]) || 0,
        openQty: parseFloat(row[8]) || 0,
        startDate: row[9] || new Date().toISOString(), // Usamos 'Assigned Date' como 'startDate'
        // NOTA: 'resourceDescription' no está en tu hoja, el HTML lo usa en el 'title' de la imagen.
        // Por ahora, podemos usar el mismo nombre del recurso o un valor predeterminado.
        resourceDescription: row[0] || 'Descripción no disponible'
      };
    });
    
    // 6. ENVIAR LA RESPUESTA
    // Devolvemos los datos ya transformados. El HTML los recibirá y los mostrará.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(data),
    };

  } catch (error) {
    console.error('Error al leer la hoja de Google:', error);
    // Si algo sale mal, enviamos un mensaje de error claro.
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ details: 'Error interno del servidor al leer la hoja de cálculo.' }),
    };
  }
};