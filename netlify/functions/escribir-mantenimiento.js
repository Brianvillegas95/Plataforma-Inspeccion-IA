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

// --- Funciones de Ayuda para Mecánicos (Actualizadas) ---

/**
 * Busca un mecánico por nombre Y determina su TareaActual_RowID
 * basado en CUALQUIER trabajo activo (Asignado o En Proceso)
 */
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

  // --- ¡INICIO DE CORRECCIÓN DE BUG! ---
  // Revisa si el mecánico tiene algún trabajo "En Proceso" o "Asignado"
  // para sincronizar su estado en caso de que el navegador se haya cerrado.
  const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
  const jobsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: produccionSheetId,
    range: 'Hoja 1!A2:N',
  });
  const jobs = jobsResponse.data.values || [];
  let activeJobRowId = null;

  for (let i = 0; i < jobs.length; i++) {
    const row = i + 2;
    const mecanicoAsignado = jobs[i][12]; // Col M
    const statusParo = jobs[i][13]; // Col N
    
    if (mecanicoAsignado === name && (statusParo === 'En Proceso' || statusParo === 'Asignado')) {
        activeJobRowId = row;
        break; // Encontramos el trabajo activo
    }
  }

  if (activeJobRowId) {
    mechanic.status = 'Ocupado';
    mechanic.TareaActual_RowID = activeJobRowId;
  } else {
    // No tiene trabajos activos, puede estar "Libre"
    mechanic.status = 'Libre';
    mechanic.TareaActual_RowID = '';
  }
  // --- ¡FIN DE CORRECCIÓN DE BUG! ---
  
  return mechanic;
}

/**
 * Encuentra a quién asignar un nuevo paro.
 * 1. Busca un mecánico "Libre".
 * 2. Si no hay, busca al "Ocupado" con el RowID más antiguo (más bajo).
 */
async function findMechanicToAssign(sheets, area) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E',
  });
  const mechanics = response.data.values || [];
  
  let freeMechanic = null;
  let oldestBusyMechanic = null;
  let oldestRowId = Infinity;

  for (let i = 0; i < mechanics.length; i++) {
    const [name, assignedArea, availability, systemStatus, tareaRowId] = mechanics[i];
    
    if (assignedArea === area && availability === 'Disponible') {
        const isFree = (!systemStatus || systemStatus === 'Libre');
        
        // 1. Prioridad: Mecánico Libre
        if (isFree) {
            freeMechanic = { row: i + 2, name: name, area: assignedArea, status: 'Libre' };
            break; // Encontramos al mejor candidato
        }

        // 2. Si no, buscar al ocupado que termine primero (RowID más bajo)
        const currentRowId = parseInt(tareaRowId, 10);
        if (systemStatus === 'Ocupado' && currentRowId && currentRowId < oldestRowId) {
            oldestRowId = currentRowId;
            oldestBusyMechanic = { row: i + 2, name: name, area: assignedArea, status: 'Ocupado' };
        }
    }
  }
  
  // Devolver al libre si existe, si no, al ocupado más antiguo
  return freeMechanic || oldestBusyMechanic || null;
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

// Actualiza Disponibilidad Y StatusSistema basado en la corrección de bug
async function updateMechanicAvailability(sheets, name, availability) {
  const mechanic = await findMechanicByName(sheets, name); // Esta función ya tiene la corrección
  if (!mechanic) throw new Error(`Mecánico ${name} no encontrado en MECANICOS_DB.`);
  
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  let newStatusSistema = mechanic.status; // Usamos el status corregido
  
  // Si se está logueando "Disponible" y el sistema vio que está "Libre", lo dejamos "Libre"
  if (availability === 'Disponible' && newStatusSistema === 'Libre') {
      newStatusSistema = 'Libre';
  } else {
  // Si está "Ocupado" o se está deslogueando, marcar como "Ocupado"
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

/**
 * Busca el próximo trabajo en la cola de un mecánico (con prioridad)
 * NUEVO: Busca trabajos "En Cola" asignados a él.
 */
async function findNextJobInQueue(sheets, mechanicName, mechanicArea) {
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!C2:N', // C: Area, G: Status maquina, M: MecanicoAsignado, N: StatusParo
  });
  const jobs = response.data.values || [];

  let highPriorityJob = null;
  let lowPriorityJob = null;

  for (let i = 0; i < jobs.length; i++) {
    const row = i + 2;
    const jobArea = jobs[i][0]; // Col C
    const jobStatusMaquina = jobs[i][4]; // Col G
    const mecanicoAsignado = jobs[i][10]; // Col M
    const jobStatusParo = jobs[i][11]; // Col N

    // Si es de su área, asignado a él, y está "En Cola"
    if (jobArea === mechanicArea && mecanicoAsignado === mechanicName && jobStatusParo === 'En Cola') {
      if (jobStatusMaquina === 'detenida' && !highPriorityJob) {
        highPriorityJob = { row: row };
        break; // Encontramos el más importante
      }
      if (jobStatusMaquina === 'trabajando' && !lowPriorityJob) {
        lowPriorityJob = { row: row };
      }
    }
  }
  return highPriorityJob || lowPriorityJob;
}

/**
 * Asigna un trabajo (ahora de "En Cola" a "Asignado")
 */
async function assignPendingJob(sheets, mechanic, job) {
  console.log(`Asignación automática de cola: ${mechanic.name} -> Fila ${job.row}`);
  // 1. Poner al mecánico como Ocupado y actualizar su TareaActual
  await updateMechanicStatus(sheets, mechanic.row, 'Ocupado', job.row);
  // 2. Actualizar el paro de "En Cola" a "Asignado"
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!N${job.row}`, // Solo Col N (StatusParo)
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [['Asignado']], // De "En Cola" a "Asignado"
    },
  });
}

async function releaseMechanicAndCheckQueue(sheets, mechanicName) {
  if (!mechanicName || mechanicName === 'En Espera') return;
  
  // findMechanicByName ahora corrige el estado
  const mechanic = await findMechanicByName(sheets, mechanicName); 
  if (!mechanic) {
      console.log(`Mecánico ${mechanicName} no encontrado.`);
      return;
  }
  
  // 1. Buscar si tiene un próximo trabajo en su cola
  const nextJob = await findNextJobInQueue(sheets, mechanic.name, mechanic.area);
  
  if (nextJob) {
      // 2a. ¡Tiene cola! Asignarle el siguiente trabajo.
      // Sigue "Ocupado", pero su TareaActual_RowID cambia
      console.log(`Mecánico ${mechanicName} liberado, asignando próximo trabajo (Fila ${nextJob.row}).`);
      await assignPendingJob(sheets, mechanic, nextJob);
  } else {
      // 2b. No tiene cola. Ponerlo "Libre".
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
      // --- Acción: ABRIR REPORTE (Nueva Lógica de Asignación) ---
      case 'abrir': {
        if (!data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "data".' }) };

        const now = new Date();
        const folio = `MAN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const areaDelParo = data[1]; // data = [fecha, area, maquina, ...]

        // 1. Encontrar a quién asignar (Nueva Lógica)
        const mechanicToAssign = await findMechanicToAssign(sheets, areaDelParo);
        
        if (!mechanicToAssign) {
            // Caso raro: No hay mecánicos Disponibles en esa área
            return { statusCode: 503, body: JSON.stringify({ error: 'No hay mecánicos disponibles (logueados) para esta área.' }) };
        }

        let statusParo;
        let newRow;

        // 2. Decidir si es "Asignado" o "En Cola"
        if (mechanicToAssign.status === 'Libre') {
            statusParo = 'Asignado';
            console.log(`Asignando a ${mechanicToAssign.name} (está Libre)`);
        } else {
            statusParo = 'En Cola';
            console.log(`Asignando a ${mechanicToAssign.name} (está Ocupado)`);
        }
        
        // 3. Escribir el paro en MANTENIMIENTO-PRODUCCION
        const dataToWrite = [ folio, ...data, '', '', '', '', mechanicToAssign.name, statusParo ];
        const response = await sheets.spreadsheets.values.append({
          spreadsheetId: produccionSheetId,
          range: 'Hoja 1!A1',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [dataToWrite] },
        });
        newRow = getRowFromRange(response.data.updates.updatedRange);
        
        // 4. Si estaba "Libre", actualizarlo a "Ocupado"
        if (mechanicToAssign.status === 'Libre') {
            await updateMechanicStatus(sheets, mechanicToAssign.row, 'Ocupado', newRow);
        }
        // Si estaba "Ocupado", no tocamos su TareaActual_RowID

        return {
          statusCode: 200,
          body: JSON.stringify({ 
            row: newRow,
            status: statusParo, // "Asignado" o "En Cola"
            mecanico: mechanicToAssign.name,
            folio: folio
          }),
        };
      }
      
      // --- Acción: REGISTRAR LLEGADA (Sin cambios) ---
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

      // --- Acción: CERRAR REPORTE (Actualizada) ---
      case 'cerrar': {
        if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
        const mecanicoQueCerro = data[1];
        
        // 1. Liberar al mecánico (La nueva función buscará su próxima tarea "En Cola")
        await releaseMechanicAndCheckQueue(sheets, mecanicoQueCerro);
        
        // 2. Actualizar la hoja de MANTENIMIENTO-PRODUCCION
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
        return { statusCode: 200, body: JSON.stringify({ message: 'Paro finalizado.' }) };
      }
      
      // --- Acción: REVISAR ESTADO (Actualizada) ---
      case 'check_status': {
        if (!row) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row".' }) };
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: produccionSheetId,
          range: `Hoja 1!M${row}:N${row}`, // Leer MecanicoAsignado y StatusParo
        });
        if (!response.data.values || !response.data.values[0]) {
          throw new Error(`No se encontraron datos para la fila ${row}`);
        }
        const [mecanico, status] = response.data.values[0];
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            mecanico: mecanico || 'N/A',
            status: status || 'Abierto' // Status puede ser "Asignado", "En Proceso", o "En Cola"
          }),
        };
      }

      // --- Acción: LOGIN DE MECÁNICO (Actualizada) ---
      case 'mecanico_check_in': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        // Esta función ahora arregla el estado ("Libre" / "Ocupado")
        const mechanic = await updateMechanicAvailability(sheets, name, 'Disponible');
        
        // Si el login te marca como "Libre", busca en la cola general
        if (mechanic.status === 'Libre' && !mechanic.TareaActual_RowID) {
            console.log(`Mecánico ${name} está libre, buscando trabajo en cola...`);
            const nextJob = await findNextJobInQueue(sheets, mechanic.name, mechanic.area);
            if (nextJob) {
                await assignPendingJob(sheets, mechanic, nextJob);
            }
        }
        return { statusCode: 200, body: JSON.stringify({ message: `Mecánico ${name} check-in.` }) };
      }

      // --- Acción: LOGOUT DE MECÁNICO (Actualizada) ---
      case 'mecanico_check_out': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        // Esta función te pondrá "No Disponible" y "Ocupado"
        await updateMechanicAvailability(sheets, name, 'No Disponible');
        return { statusCode: 200, body: JSON.stringify({ message: `Mecánico ${name} check-out.` }) };
      }

      // --- Acción: OBTENER TAREAS DE MECÁNICO (Actualizada) ---
      case 'get_mecanico_tareas': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        const mechanic = await findMechanicByName(sheets, name); // Función ya corregida
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

                // "En Proceso" es siempre la tarea actual
                if (statusParo === 'En Proceso') {
                    tareaActual = tarea;
                }
                // "Asignado" (y coincide con RowID) es la tarea actual
                else if (statusParo === 'Asignado' && String(row) === String(mechanic.TareaActual_RowID)) {
                    tareaActual = tarea;
                }
                // "En Cola" va a la lista de cola
                else if (statusParo === 'En Cola') {
                    tareasEnCola.push(tarea);
                }
                // (Ignoramos "Cerrado")
            }
        }
        
        // Si "En Proceso" se encontró, puede haber una "Asignada" que es la siguiente
        // Esto es para el caso: 1 en proceso, 1 asignada (la siguiente), y 1 en cola
        if (tareaActual && tareaActual.statusParo === 'En Proceso' && mechanic.TareaActual_RowID) {
             for (let i = 0; i < jobs.length; i++) {
                 const row = i + 2;
                 if (String(row) === String(mechanic.TareaActual_RowID)) {
                     const [folio, , area, maquina, estacion, , statusMaquina, , , , , , mecanicoAsignado, statusParo] = jobs[i];
                     if(mecanicoAsignado === name && statusParo === 'Asignado') {
                         // Esta es la siguiente, la ponemos al inicio de la cola
                         tareasEnCola.unshift({ folio, area, maquina, estacion, statusParo, statusMaquina });
                     }
                 }
             }
        }

        // Ordenar la cola por prioridad (detenida primero)
        tareasEnCola.sort((a, b) => {
            if (a.statusMaquina === 'detenida' && b.statusMaquina !== 'detenida') return -1;
            if (a.statusMaquina !== 'detenida' && b.statusMaquina === 'detenida') return 1;
            return 0; // Si son iguales, mantiene el orden de la hoja
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