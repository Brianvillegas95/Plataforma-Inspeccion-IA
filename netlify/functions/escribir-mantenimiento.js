const { google } = require('googleapis');

// --- Configuración de Autenticación (Sin cambios) ---
function getAuth() {
  const credentials = {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Error de configuración: Faltan credenciales.');
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsAPI(auth) {
  return google.sheets({ version: 'v4', auth });
}

function getRowFromRange(range) {
  if (!range) throw new Error('No se recibió un rango de la API de Google.');
  const match = range.match(/!([A-Z]+)(\d+)/);
  if (match && match[2]) {
    return parseInt(match[2], 10);
  }
  throw new Error(`No se pudo extraer el número de fila del rango: ${range}`);
}

// --- Funciones de Ayuda para Mecánicos (Corregidas) ---

// Sincroniza el estado del mecánico basado en trabajos activos
async function findMechanicByName(sheets, name) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const mecsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E',
  });
  const mechanics = mecsResponse.data.values || [];
  let mechanic = null;
  for (let i = 0; i < mechanics.length; i++) {
    if (mechanics[i][0] === name) {
      mechanic = {
        row: i + 2, name: mechanics[i][0], area: mechanics[i][1],
        availability: mechanics[i][2], status: mechanics[i][3],
        TareaActual_RowID: mechanics[i][4]
      };
      break;
    }
  }
  if (!mechanic) return null;

  // Sincronización de estado (Bug de "me aparece libre")
  const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
  const jobsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: produccionSheetId,
    range: 'Hoja 1!M2:N', // Col M (MecanicoAsignado), Col N (StatusParo)
  });
  const jobs = jobsResponse.data.values || [];
  let hasActiveJob = false;

  for (let i = 0; i < jobs.length; i++) {
    const mecanicoAsignado = jobs[i][0]; // Col M
    const statusParo = jobs[i][1]; // Col N
    
    if (mecanicoAsignado === name && (statusParo === 'En Proceso' || statusParo === 'Asignado')) {
        hasActiveJob = true;
        break; 
    }
  }

  if (hasActiveJob) {
    mechanic.status = 'Ocupado';
  } else {
    mechanic.status = 'Libre';
  }
  
  return mechanic;
}

// Cuenta los trabajos "En Cola" (Balanceo de Carga)
async function getMechanicQueueCounts(sheets) {
    const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: produccionSheetId,
        range: 'Hoja 1!M2:N', 
    });
    const jobs = response.data.values || [];
    const queueCounts = {};

    for (const [mecanico, status] of jobs) {
        if (mecanico && status === 'En Cola') {
            queueCounts[mecanico] = (queueCounts[mecanico] || 0) + 1;
        }
    }
    return queueCounts;
}

// Encuentra a quién asignar (Balanceo de Carga)
async function findMechanicToAssign(sheets, area) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const mecsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E',
  });
  const mechanics = mecsResponse.data.values || [];
  const queueCounts = await getMechanicQueueCounts(sheets);

  let freeMechanic = null;
  let bestBusyMechanic = null;
  let minQueueCount = Infinity;

  for (let i = 0; i < mechanics.length; i++) {
    const [name, assignedArea, availability, systemStatus] = mechanics[i];
    
    if (assignedArea === area && availability === 'Disponible') {
        const isFree = (!systemStatus || systemStatus === 'Libre');
        
        if (isFree) {
            freeMechanic = { row: i + 2, name: name, area: assignedArea, status: 'Libre' };
            break; 
        }

        if (systemStatus === 'Ocupado') {
            const currentQueueCount = queueCounts[name] || 0;
            if (currentQueueCount < minQueueCount) {
                minQueueCount = currentQueueCount;
                bestBusyMechanic = { row: i + 2, name: name, area: assignedArea, status: 'Ocupado' };
            }
        }
    }
  }
  return freeMechanic || bestBusyMechanic || null;
}

async function updateMechanicStatus(sheets, row, status, reportRowId) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!D${row}:E${row}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[status, reportRowId || '']],
    },
  });
}

// Actualiza Disponibilidad (Sincronizado)
async function updateMechanicAvailability(sheets, name, availability) {
  const mechanic = await findMechanicByName(sheets, name); 
  if (!mechanic) throw new Error(`Mecánico ${name} no encontrado en MECANICOS_DB.`);
  
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  let newStatusSistema = mechanic.status; 

  if (availability === 'Disponible' && newStatusSistema === 'Libre') {
      newStatusSistema = 'Libre';
  } else {
      newStatusSistema = 'Ocupado';
  }
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!C${mechanic.row}:D${mechanic.row}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[availability, newStatusSistema]],
    },
  });
  
  return mechanic;
}

// --- Lógica de "Cola Compartida" (WMS) ---

async function findNextJobInSharedQueue(sheets, mechanicArea) {
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!C2:N', 
  });
  const jobs = response.data.values || [];

  let highPriorityJob = null;
  let lowPriorityJob = null;

  for (let i = 0; i < jobs.length; i++) {
    const row = i + 2;
    const jobArea = jobs[i][0]; 
    const jobStatusMaquina = jobs[i][4]; 
    const jobStatusParo = jobs[i][11]; 

    if (jobArea === mechanicArea && jobStatusParo === 'En Cola') {
      if (jobStatusMaquina === 'detenida' && !highPriorityJob) {
        highPriorityJob = { row: row };
        break; 
      }
      if (jobStatusMaquina === 'trabajando' && !lowPriorityJob) {
        lowPriorityJob = { row: row };
      }
    }
  }
  return highPriorityJob || lowPriorityJob;
}

async function reAssignPendingJob(sheets, mechanic, jobRow) {
  console.log(`RE-ASIGNACIÓN dinámica: ${mechanic.name} -> Fila ${jobRow}`);
  
  await updateMechanicStatus(sheets, mechanic.row, 'Ocupado', jobRow);
  
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!M${jobRow}:N${jobRow}`, 
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[mechanic.name, 'Asignado']], 
    },
  });
}

async function releaseMechanicAndCheckQueue(sheets, mechanicName) {
  if (!mechanicName || mechanicName === 'En Espera') return;
  
  const mechanic = await findMechanicByName(sheets, mechanicName); 
  if (!mechanic) {
      console.log(`Mecánico ${mechanicName} no encontrado.`);
      return;
  }
  
  const nextJob = await findNextJobInSharedQueue(sheets, mechanic.area);
  
  if (nextJob) {
      console.log(`Mecánico ${mechanicName} liberado, RE-ASIGNANDO trabajo (Fila ${nextJob.row}).`);
      await reAssignPendingJob(sheets, mechanic, nextJob.row);
  } else {
      console.log(`Mecánico ${mechanicName} liberado. No hay trabajos en cola.`);
      await updateMechanicStatus(sheets, mechanic.row, 'Libre', '');
  }
}

// --- Handler Principal ---
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  try {
    const { action, data, row, name } = JSON.parse(event.body);
    if (!action) {
       return { statusCode: 400, body: JSON.stringify({ error: 'Falta "action".' }) };
    }
    const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
    if (!produccionSheetId) {
      throw new Error('MANTENIMIENTO_SHEET_ID no está configurado.');
    }
    const auth = getAuth();
    const sheets = getSheetsAPI(auth);
    
    switch (action) {
      // --- Acción: ABRIR REPORTE (Sin cambios) ---
      case 'abrir': {
        if (!data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "data".' }) };
        const now = new Date();
        const folio = `MAN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const areaDelParo = data[1];

        const mechanicToAssign = await findMechanicToAssign(sheets, areaDelParo);
        if (!mechanicToAssign) {
            return { statusCode: 503, body: JSON.stringify({ error: 'No hay mecánicos disponibles (logueados) para esta área.' }) };
        }
        let statusParo;
        if (mechanicToAssign.status === 'Libre') {
            statusParo = 'Asignado';
            console.log(`Asignando a ${mechanicToAssign.name} (está Libre)`);
        } else {
            statusParo = 'En Cola';
            console.log(`Asignando a ${mechanicToAssign.name} (está Ocupado, tiene la cola más corta)`);
        }
        const dataToWrite = [ folio, ...data, '', '', '', '', mechanicToAssign.name, statusParo ];
        const response = await sheets.spreadsheets.values.append({
          spreadsheetId: produccionSheetId,
          range: 'Hoja 1!A1',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [dataToWrite] },
        });
        const newRow = getRowFromRange(response.data.updates.updatedRange);
        if (mechanicToAssign.status === 'Libre') {
            await updateMechanicStatus(sheets, mechanicToAssign.row, 'Ocupado', newRow);
        }
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            row: newRow, status: statusParo, mecanico: mechanicToAssign.name, folio: folio
          }),
        };
      }
      
      // --- ¡INICIO DE LA CORRECCIÓN DE 'CERRAR'! ---
      case 'cerrar': {
        if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
        const mecanicoQueCerro = data[1]; 
        
        // PASO 1: Marcar el trabajo como "Cerrado" en la hoja de producción.
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: produccionSheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
              { range: `Hoja 1!I${row}:J${row}`, values: [[ data[0], data[1] ]] }, 
              { range: `Hoja 1!L${row}`, values: [[ data[2] ]] }, 
              { range: `Hoja 1!N${row}`, values: [['Cerrado']] } 
            ]
          }
        });

        // PASO 2: AHORA SÍ, liberar al mecánico y buscar en la cola compartida.
        // (Como el trabajo ya está "Cerrado", findMechanicByName funcionará)
        await releaseMechanicAndCheckQueue(sheets, mecanicoQueCerro);
        
        return { statusCode: 200, body: JSON.stringify({ message: 'Paro finalizado.' }) };
      }
      // --- ¡FIN DE LA CORRECCIÓN DE 'CERRAR'! ---
      
      // --- Acción: LOGIN DE MECÁNICO (Corregido) ---
      case 'mecanico_check_in': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        // Esta función ahora arregla el estado ("Libre" / "Ocupado")
        const mechanic = await updateMechanicAvailability(sheets, name, 'Disponible');
        
        // Si el login te marca como "Libre", busca en la "Cola Compartida"
        if (mechanic.status === 'Libre' && !mechanic.TareaActual_RowID) {
            console.log(`Mecánico ${name} está libre, buscando trabajo en COLA COMPARTIDA...`);
            const nextJob = await findNextJobInSharedQueue(sheets, mechanic.area);
            if (nextJob) {
                await reAssignPendingJob(sheets, mechanic, nextJob.row);
            }
        }
        return { statusCode: 200, body: JSON.stringify({ message: `Mecánico ${name} check-in.` }) };
      }

      // --- (Resto de acciones: 'llegada', 'check_status', 'mecanico_check_out', 'get_mecanico_tareas' no cambian) ---
      case 'llegada': {
        if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: produccionSheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
              { range: `Hoja 1!K${row}`, values: [data] }, 
              { range: `Hoja 1!N${row}`, values: [['En Proceso']] } 
            ]
          }
        });
        return { statusCode: 200, body: JSON.stringify({ message: 'Llegada registrada.' }) };
      }
      case 'check_status': {
        if (!row) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row".' }) };
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: produccionSheetId,
          range: `Hoja 1!M${row}:N${row}`, 
        });
        if (!response.data.values || !response.data.values[0]) {
          throw new Error(`No se encontraron datos para la fila ${row}`);
        }
        const [mecanico, status] = response.data.values[0];
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            mecanico: mecanico || 'N/A',
            status: status || 'Abierto' 
          }),
        };
      }
      case 'mecanico_check_out': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        await updateMechanicAvailability(sheets, name, 'No Disponible');
        return { statusCode: 200, body: JSON.stringify({ message: `Mecánico ${name} check-out.` }) };
      }
      case 'get_mecanico_tareas': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        const mechanic = await findMechanicByName(sheets, name); 
        if (!mechanic) return { statusCode: 404, body: JSON.stringify({ error: 'Mecánico no encontrado.' }) };

        let tareaActual = null;
        const tareasEnCola = [];
        
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: produccionSheetId,
          range: 'Hoja 1!A2:N', 
        });
        const jobs = response.data.values || [];
        
        for (let i = 0; i < jobs.length; i++) {
            const row = i + 2;
            const [folio, , area, maquina, estacion, , statusMaquina, , , , , , mecanicoAsignado, statusParo] = jobs[i];
            
            if (mecanicoAsignado === name) {
                const tarea = { folio, area, maquina, estacion, statusParo, statusMaquina };
                if (statusParo === 'En Proceso') {
                    tareaActual = tarea;
                }
                else if (statusParo === 'Asignado') {
                    if (!tareaActual) {
                         tareaActual = tarea;
                    } else {
                         tareasEnCola.push(tarea);
                    }
                }
                else if (statusParo === 'En Cola') {
                    tareasEnCola.push(tarea);
                }
            }
        }
        
        tareasEnCola.sort((a, b) => {
            if (a.statusMaquina === 'detenida' && b.statusMaquina !== 'detenida') return -1;
            if (a.statusMaquina !== 'detenida' && b.statusMaquina === 'detenida') return 1;
            return 0;
        });

        return { statusCode: 200, body: JSON.stringify({ tareaActual, tareasEnCola }) };
      }
      
      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Acción desconocida: "${action}".` }) };
    }
  } catch (error) {
    console.error('Error fatal en la función:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error al procesar la solicitud: ' + error.message }),
    };
  }
};