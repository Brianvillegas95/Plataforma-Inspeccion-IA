const { google } = require('googleapis');

exports.handler = async (event) => {
  try {
    const hojaId = process.env.PRODUCTION_ORDERS_ID;
    if (!hojaId) {
      throw new Error('El ID de la hoja de Producción no está configurado.');
    }
    
    const rango = 'Hoja 1!A:X';

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

    // === MAPEANDO Y CONVIRTIENDO CADA FILA ===
    const allResources = rows.slice(1)
      .filter(row => row[0] && !row[0].toUpperCase().startsWith('O')) // Filtrar operadores
      .map(row => {
        // Leemos los valores de las columnas
        let required = parseFloat(row[9]) || 0;
        let applied = parseFloat(row[10]) || 0;
        let open = parseFloat(row[11]) || 0;
        const basis = row[5] || '';
        const usageRate = parseFloat(row[6]) || 0;

        // **NUEVA LÓGICA DE CONVERSIÓN**
        // Si Basis es 'Item' y tenemos un Usage Rate válido, convertimos de horas a piezas.
        if (basis.toLowerCase() === 'item' && usageRate > 0) {
          required = required / usageRate;
          applied = applied / usageRate;
          open = open / usageRate;
        }

        // Devolvemos el objeto con los valores ya en piezas
        return {
          resource: row[0],
          department: row[3],
          requiredQty: required,
          appliedQty: applied,
          openQty: open,
          startDate: row[14],
          completionDate: row[15],
          job: row[18],
          assembly: row[20],
          status: row[21] || 'Unknown',
          resourceDescription: row[23]
        };
      });

    // === AGRUPANDO POR ORDEN DE TRABAJO (JOB) ===
    const groupedJobs = allResources.reduce((acc, resource) => {
      const jobKey = resource.job;
      if (!jobKey) return acc;

      if (!acc[jobKey]) {
        // Tomamos los datos de la primera operación que encontramos para el Job
        const required = resource.requiredQty;
        const applied = resource.appliedQty;
        const progress = required > 0 ? (applied / required) * 100 : 0;
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const completionDate = resource.completionDate ? new Date(resource.completionDate) : null;
        const isDelayed = completionDate && completionDate < today && resource.status.toLowerCase() !== 'completed';

        acc[jobKey] = {
          job: resource.job,
          assembly: resource.assembly,
          department: resource.department,
          status: resource.status,
          requiredQty: required,
          appliedQty: applied,
          startDate: resource.startDate,
          completionDate: resource.completionDate,
          progress: progress.toFixed(1),
          isDelayed: isDelayed,
          resources: []
        };
      }
      
      // Siempre agregamos el recurso a la lista del job
      acc[jobKey].resources.push({
        name: resource.resource,
        description: resource.resourceDescription
      });

      // **POSIBLE MEJORA A FUTURO**: Si quisiéramos sumar las piezas aplicadas de todas
      // las operaciones, lo haríamos aquí. Por ahora, usamos los datos de la primera.
      // Ejemplo: acc[jobKey].appliedQty += resource.appliedQty;
      
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