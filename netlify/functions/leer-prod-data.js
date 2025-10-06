const { google } = require('googleapis');

exports.handler = async (event) => {
  try {
    const hojaId = process.env.PRODUCTION_ORDERS_ID;
    if (!hojaId) {
      throw new Error('El ID de la hoja de Producción no está configurado.');
    }
    
    // Leemos el rango completo de columnas que mencionaste
    const rango = 'Hoja 1!A:X';

    // ... (Autenticación - sin cambios)
    const credentials = {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: hojaId, range: rango });
    const rows = response.data.values;

    if (!rows || rows.length <= 1) {
      return { statusCode: 200, body: JSON.stringify([]) };
    }

    const allResources = rows.slice(1)
      .filter(row => row[0] && !row[0].toUpperCase().startsWith('O')) // Filtrar operadores
      .map(row => ({
        // Mapeo de columnas basado en tu lista
        resource: row[0],
        department: row[3],
        requiredQty: parseFloat(row[9]) || 0,
        appliedQty: parseFloat(row[10]) || 0,
        openQty: parseFloat(row[11]) || 0,
        startDate: row[14],
        completionDate: row[15],
        job: row[18],
        assembly: row[20],
        status: row[21] || 'Unknown',
        resourceDescription: row[23]
      }));

    const groupedJobs = allResources.reduce((acc, resource) => {
      const jobKey = resource.job;
      if (!jobKey) return acc;

      if (!acc[jobKey]) {
        const required = resource.requiredQty;
        const applied = resource.appliedQty;
        // **NUEVO**: Calculamos el porcentaje de avance
        const progress = required > 0 ? (applied / required) * 100 : 0;
        
        // **NUEVO**: Determinamos si la orden está atrasada
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Para comparar solo la fecha
        const completionDate = resource.completionDate ? new Date(resource.completionDate) : null;
        const isDelayed = completionDate && completionDate < today && resource.status.toLowerCase() !== 'completed';

        acc[jobKey] = {
          job: resource.job,
          assembly: resource.assembly,
          department: resource.department,
          status: resource.status,
          requiredQty: required,
          appliedQty: applied,
          openQty: resource.openQty,
          startDate: resource.startDate,
          completionDate: resource.completionDate,
          progress: progress.toFixed(1), // Avance con un decimal
          isDelayed: isDelayed, // true o false
          resources: []
        };
      }
      acc[jobKey].resources.push({
        name: resource.resource,
        description: resource.resourceDescription
      });
      return acc;
    }, {});
    
    const data = Object.values(groupedJobs);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };

  } catch (error) {
    console.error('Error al leer la hoja de Google:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ details: 'Error interno del servidor.' }),
    };
  }
};