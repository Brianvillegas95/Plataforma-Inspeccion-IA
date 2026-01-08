const { google } = require('googleapis');

// --- Configuración de Autenticación ---
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
  return null;
}

// --- Funciones de Verificación ---

async function checkForOpenDuplicate(sheets, area, maquina, estacion) {
  const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: produccionSheetId,
    range: 'Hoja 1!C2:N', 
  });
  const jobs = response.data.values || [];
  
  const normArea = area ? area.trim() : '';
  const normMaquina = maquina ? maquina.trim() : '';
  const normEstacion = estacion ? estacion.trim() : '';

  for (const job of jobs) {
    const jobArea = job[0] ? job[0].trim() : '';
    const jobMaquina = job[1] ? job[1].trim() : '';
    const jobEstacion = job[2] ? job[2].trim() : '';
    const jobStatus = job[11] ? job[11].trim() : '';

    if (jobArea === normArea && jobMaquina === normMaquina && jobEstacion === normEstacion &&
        (jobStatus === 'Asignado' || jobStatus === 'En Proceso' || jobStatus === 'En Cola')) {
      return true; 
    }
  }
  return false;
}

// --- Funciones de Ayuda para Mecánicos ---

async function findMechanicByName(sheets, name) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const mecsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E',
  });
  const mechanics = mecsResponse.data.values || [];
  for (let i = 0; i < mechanics.length; i++) {
    const dbName = mechanics[i][0] ? mechanics[i][0].trim() : '';
    const searchName = name ? name.trim() : '';
    if (dbName === searchName) {
      const mechanicInfo = {
        row: i + 2, name: mechanics[i][0], area: mechanics[i][1],
        availability: mechanics[i][2], 
        status: mechanics[i][3],
        TareaActual_RowID: mechanics[i][4]
      };

      // *** INICIO: CORRECCIÓN DE SINCRONIZACIÓN (Póliza de seguro) ***
      const activeJob = await findMechanicActiveJob(sheets, name); // Busca trabajo en MANTENIMIENTO-PRODUCCION
      const expectedStatus = activeJob ? 'Ocupado' : 'Libre';
      const expectedRowID = activeJob ? activeJob.row.toString() : '';

      // Si el estado en la DB (MECANICOS_DB) no coincide con el estado real
      if (mechanicInfo.status !== expectedStatus || mechanicInfo.TareaActual_RowID !== expectedRowID) {
          console.log(`SINCRONIZACIÓN FORZADA para ${name}: DB=${mechanicInfo.status}, REAL=${expectedStatus}`);
          await updateMechanicStatus(sheets, mechanicInfo.row, expectedStatus, expectedRowID);
          mechanicInfo.status = expectedStatus;
          mechanicInfo.TareaActual_RowID = expectedRowID;
      }
      // *** FIN: CORRECCIÓN DE SINCRONIZACIÓN ***

      return mechanicInfo;
    }
  }
  return null;
}

async function findMechanicActiveJob(sheets, name) {
    const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
    const jobsResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: produccionSheetId,
        range: 'Hoja 1!M2:N',
    });
    const jobs = jobsResponse.data.values || [];
    for (let i = 0; i < jobs.length; i++) {
        const mecanicoAsignado = jobs[i][0];
        const statusParo = jobs[i][1];
        if (mecanicoAsignado === name && (statusParo === 'En Proceso' || statusParo === 'Asignado')) {
            return { row: i + 2, status: statusParo };
        }
    }
    return null;
}

async function findMechanicToAssign(sheets, area) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const mecsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: 'Hoja 1!A2:E',
  });
  const mechanics = mecsResponse.data.values || [];
  
  let freeMechanic = null;
  const normArea = area ? area.trim() : '';
  
  for (let i = 0; i < mechanics.length; i++) {
    const [name, assignedArea, availability, systemStatus] = mechanics[i];
    const normAssignedArea = assignedArea ? assignedArea.trim() : '';
    
    if (normAssignedArea === normArea && availability === 'Disponible') {
        const isFree = (!systemStatus || systemStatus === 'Libre');
        if (isFree) {
            freeMechanic = { row: i + 2, name: name, area: assignedArea, status: 'Libre' };
            break; 
        }
    }
  }
  return freeMechanic || null;
}

// **Función clave para actualizar el estado Y el RowID de la tarea**
async function updateMechanicStatus(sheets, row, status, reportRowId) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!D${row}:E${row}`, // D: Status, E: TareaActual_RowID
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[status, reportRowId || '']], // reportRowId puede ser la fila o ""
    },
  });
}

async function updateMechanicAvailability(sheets, name, availability) {
  const mechanic = await findMechanicByName(sheets, name); 
  if (!mechanic) throw new Error(`Mecánico ${name} no encontrado en MECANICOS_DB.`);
  
  const activeJob = await findMechanicActiveJob(sheets, name);
  let newStatusSistema;

  if (availability === 'Disponible') {
      newStatusSistema = activeJob ? 'Ocupado' : 'Libre';
  } else {
      newStatusSistema = 'Ocupado'; 
  }
  
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: `Hoja 1!C${mechanic.row}:D${mechanic.row}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[availability, newStatusSistema]],
    },
  });
  
  mechanic.status = newStatusSistema;
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
  const normMechanicArea = mechanicArea ? mechanicArea.trim() : '';

  for (let i = 0; i < jobs.length; i++) {
    const row = i + 2;
    const jobArea = jobs[i][0]; 
    const jobStatusMaquina = jobs[i][4];
    const mecanicoAsignado = jobs[i][10];
    const jobStatusParo = jobs[i][11];
    const normJobArea = jobArea ? jobArea.trim() : '';

    if (normJobArea === normMechanicArea && mecanicoAsignado === 'En Espera' && jobStatusParo === 'En Cola') {
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
  console.log(`RE-ASIGNACIÓN dinámica (Pull): ${mechanic.name} -> Fila ${jobRow}`);
  // Asignar el RowID al mecánico al reasignar desde la cola
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

async function findAndAssignNextJob(sheets, mechanicName) {
  if (!mechanicName || mechanicName === 'En Espera') return;
  
  const mechanic = await findMechanicByName(sheets, mechanicName.trim()); 
  if (!mechanic) {
      console.log(`Mecánico ${mechanicName} no encontrado en DB.`);
      return;
  }
  
  const nextJob = await findNextJobInSharedQueue(sheets, mechanic.area);
  
  if (nextJob) {
      console.log(`Mecánico ${mechanicName} está "Libre", asignando nuevo trabajo (Fila ${nextJob.row}).`);
      await reAssignPendingJob(sheets, mechanic, nextJob.row);
  } else {
      console.log(`Mecánico ${mechanicName} libre. No hay trabajos en cola "En Espera".`);
      // Limpiar RowID al quedar libre
      await updateMechanicStatus(sheets, mechanic.row, 'Libre', ''); 
  }
}

async function releaseAllJobs(sheets, mechanicName) {
    const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId,
        range: 'Hoja 1!M2:N',
    });
    const jobs = response.data.values || [];
    const jobsToRelease = [];

    for (let i = 0; i < jobs.length; i++) {
        const row = i + 2;
        const mecanicoAsignado = jobs[i][0];
        const statusParo = jobs[i][1];
        if (mecanicoAsignado === mechanicName && 
            (statusParo === 'Asignado' || statusParo === 'En Proceso' || statusParo === 'En Cola')) {
            jobsToRelease.push(row);
        }
    }

    if (jobsToRelease.length === 0) return;

    const dataForBatchUpdate = jobsToRelease.map(row => ({
        range: `Hoja 1!M${row}:N${row}`,
        values: [['En Espera', 'En Cola']],
    }));
    
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: spreadsheetId,
        resource: { valueInputOption: 'USER_ENTERED', data: dataForBatchUpdate }
    });
}


// --- HANDLER PRINCIPAL ---
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  try {
    const { action, data, row, name, sessionRow, rescueMecanico, newMechanic, oldMechanic } = JSON.parse(event.body);

    if (!action) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "action".' }) };
    
    const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
    const registrosSheetId = process.env.REGISTROSMECANICOS_SHEET_ID; 
    const mecanicosSheetId = process.env.MECANICOS_SHEET_ID;

    if (!produccionSheetId) throw new Error('MANTENIMIENTO_SHEET_ID no está configurado.');
    
    const auth = getAuth();
    const sheets = getSheetsAPI(auth);
    
    switch (action) {
      
      case 'abrir': {
        if (!data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "data".' }) };
        const [fechaApertura, areaDelParo, maquinaDelParo, estacionDelParo, operador, statusMaquina, workOrder] = data;

        const isDuplicate = await checkForOpenDuplicate(sheets, areaDelParo, maquinaDelParo, estacionDelParo);
        if (isDuplicate) return { statusCode: 409, body: JSON.stringify({ error: 'Ya existe un reporte de paro activo para esta máquina.' }) };

        const now = new Date();
        const folio = `MAN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        
        const mechanicToAssign = await findMechanicToAssign(sheets, areaDelParo);
        let statusParo = mechanicToAssign ? 'Asignado' : 'En Cola';
        let mecanicoAsignado = mechanicToAssign ? mechanicToAssign.name : 'En Espera';
        
        const dataToWrite = [ folio, ...data, '', '', '', '', mecanicoAsignado, statusParo ];
        const response = await sheets.spreadsheets.values.append({
          spreadsheetId: produccionSheetId,
          range: 'Hoja 1!A1',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [dataToWrite] },
        });

        const newRow = getRowFromRange(response.data.updates.updatedRange);
        // Asignar el RowID al nuevo mecánico
        if (mechanicToAssign) await updateMechanicStatus(sheets, mechanicToAssign.row, 'Ocupado', newRow);
        
        return { statusCode: 200, body: JSON.stringify({ row: newRow, status: statusParo, mecanico: mecanicoAsignado, folio: folio }) };
      }
      
      case 'cerrar': {
        if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
        const nombreMecanicoFormulario = data[1]; 
        
        const getResponse = await sheets.spreadsheets.values.get({ spreadsheetId: produccionSheetId, range: `Hoja 1!M${row}` });
        const mecanicoAsignadoOriginal = getResponse.data.values ? getResponse.data.values[0][0] : null;
        
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: produccionSheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
              { range: `Hoja 1!I${row}:J${row}`, values: [[ data[0], nombreMecanicoFormulario ]] }, 
              { range: `Hoja 1!L${row}`, values: [[ data[2] ]] }, 
              { range: `Hoja 1!N${row}`, values: [['Cerrado']] } 
            ]
          }
        });

        if (mecanicoAsignadoOriginal && mecanicoAsignadoOriginal !== 'En Espera') {
            await findAndAssignNextJob(sheets, mecanicoAsignadoOriginal);
        }
        return { statusCode: 200, body: JSON.stringify({ message: 'Paro finalizado.' }) };
      }
      
      case 'mecanico_check_in': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        
        const mechanic = await updateMechanicAvailability(sheets, name, 'Disponible');
        if (mechanic.status === 'Libre') await findAndAssignNextJob(sheets, mechanic.name);

        let newSessionRow = null;
        if (registrosSheetId) {
            try {
                const fechaEntrada = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
                const appendRes = await sheets.spreadsheets.values.append({
                    spreadsheetId: registrosSheetId, range: 'Hoja 1!A1', valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
                    resource: { values: [[fechaEntrada, name]] } 
                });
                newSessionRow = getRowFromRange(appendRes.data.updates.updatedRange);
            } catch (e) { console.error("Error registro tiempo:", e); }
        }
        return { statusCode: 200, body: JSON.stringify({ message: `Check-in OK.`, sessionRow: newSessionRow }) };
      }

      case 'llegada': {
        if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "data".' }) };
        
        const updates = [
            { range: `Hoja 1!K${row}`, values: [data] },         
            { range: `Hoja 1!N${row}`, values: [['En Proceso']] } 
        ];

        // LÓGICA DE RESCATE (Asignación manual)
        if (rescueMecanico) {
             updates.push({ range: `Hoja 1!M${row}`, values: [[rescueMecanico]] });
             
             // Asignar TareaActual_RowID al mecánico rescatista
             const mecInfo = await findMechanicByName(sheets, rescueMecanico);
             if (mecInfo) {
                 await updateMechanicStatus(sheets, mecInfo.row, 'Ocupado', row); // <-- RowID para el nuevo
             }
        }

        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: produccionSheetId, resource: { valueInputOption: 'USER_ENTERED', data: updates }
        });
        return { statusCode: 200, body: JSON.stringify({ message: 'Llegada registrada.' }) };
      }

      case 'escalar_paro': {
        if (!row) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row".' }) };
        await sheets.spreadsheets.values.update({
          spreadsheetId: produccionSheetId, range: `Hoja 1!G${row}`, valueInputOption: 'USER_ENTERED',
          resource: { values: [['detenida']] },
        });
        return { statusCode: 200, body: JSON.stringify({ message: 'Paro escalado a DETENIDA.' }) };
      }

      case 'check_status': {
        if (!row) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row".' }) };
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: produccionSheetId, range: `Hoja 1!G${row}:N${row}` });
        const rowData = response.data.values?.[0] || [];
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            mecanico: rowData[6] || 'N/A', status: rowData[7] || 'Abierto', statusMaquina: rowData[0] || 'trabajando' 
          }),
        };
      }
      
      case 'mecanico_check_out': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        const mechanic = await findMechanicByName(sheets, name);
        if (mechanic) {
            await releaseAllJobs(sheets, name);
            // Al hacer check-out, se marca como No Disponible, Libre y se limpia TareaActual_RowID
            await sheets.spreadsheets.values.update({
                spreadsheetId: process.env.MECANICOS_SHEET_ID,
                range: `Hoja 1!C${mechanic.row}:E${mechanic.row}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [['No Disponible', 'Libre', '']] },
            });
        }
        if (registrosSheetId && sessionRow) {
            try {
                const fechaSalida = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
                await sheets.spreadsheets.values.update({
                    spreadsheetId: registrosSheetId, range: `Hoja 1!C${sessionRow}`, valueInputOption: 'USER_ENTERED',
                    resource: { values: [[fechaSalida]] }
                });
            } catch (e) { console.error("Error salida tiempo:", e); }
        }
        return { statusCode: 200, body: JSON.stringify({ message: `Check-out OK.` }) };
      }
      
      // INICIO: REEMPLAZO COMPLETO DEL CASE 'get_mecanico_tareas'
      case 'get_mecanico_tareas': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        const mechanic = await findMechanicByName(sheets, name);
        if (!mechanic) return { statusCode: 404, body: JSON.stringify({ error: 'Mecánico no encontrado.' }) };
        
        const normMechanicArea = mechanic.area ? mechanic.area.trim() : '';
        let tareaActual = null;
        
        const tareasEnColaArea = [];
        const tareasEnColaOtrasAreas = [];
        
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: produccionSheetId, range: 'Hoja 1!A2:N' });
        const jobs = response.data.values || [];
        
        for (let i = 0; i < jobs.length; i++) {
            const row = i + 2; 
            const [folio, , area, maquina, estacion, , statusMaquina, , , , , , mecanicoAsignado, statusParo] = jobs[i];
            const jobArea = area ? area.trim() : '';
            // Excluimos Cerrado y Cerrado Manual
            if (!mecanicoAsignado || !statusParo || statusParo === 'Cerrado' || statusParo === 'Cerrado Manual') continue; 
            
            const tarea = { row, folio, area, maquina, estacion, statusParo, statusMaquina };
            
            // --- Lógica de Tarea ASIGNADA o EN PROCESO (Propia) ---
            if (mecanicoAsignado === name) {
                // Siempre priorizar 'En Proceso' sobre 'Asignado'
                if (statusParo === 'En Proceso') {
                    if (!tareaActual || tareaActual.statusParo !== 'En Proceso') tareaActual = tarea;
                }
                else if (statusParo === 'Asignado') {
                    if (!tareaActual) tareaActual = tarea;
                    // Si ya hay una TareaActual, esta 'Asignado' pasa a la cola de su área o de otras
                    else if (jobArea === normMechanicArea) tareasEnColaArea.push(tarea);
                    else tareasEnColaOtrasAreas.push(tarea);
                } 
            } 
            // --- Lógica de Tareas EN COLA (En Espera) ---
            else if (mecanicoAsignado === 'En Espera' && statusParo === 'En Cola') {
                if (jobArea === normMechanicArea) {
                    tareasEnColaArea.push(tarea); 
                } else {
                    tareasEnColaOtrasAreas.push(tarea);
                }
            }
        }
        
        // 1. Ordenar Tareas En Cola (Área Propia)
        tareasEnColaArea.sort((a, b) => {
            if (a.statusMaquina === 'detenida' && b.statusMaquina !== 'detenida') return -1;
            if (a.statusMaquina !== 'detenida' && b.statusMaquina === 'detenida') return 1;
            return a.row - b.row;
        });
        
        // 2. Ordenar Tareas En Cola (Otras Áreas)
        tareasEnColaOtrasAreas.sort((a, b) => {
            if (a.statusMaquina === 'detenida' && b.statusMaquina !== 'detenida') return -1;
            if (a.statusMaquina !== 'detenida' && b.statusMaquina === 'detenida') return 1;
            return a.row - b.row;
        });

        return { 
            statusCode: 200, 
            body: JSON.stringify({ 
                tareaActual, 
                tareasEnColaArea,
                tareasEnColaOtrasAreas 
            }) 
        };
      }
      // FIN: REEMPLAZO COMPLETO DEL CASE 'get_mecanico_tareas'
      
      case 'get_mecanicos_activos': {
          const spreadsheetId = process.env.MECANICOS_SHEET_ID;
          if (!spreadsheetId) throw new Error('MECANICOS_SHEET_ID no configurado.');
          const mecsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'Hoja 1!A2:C',
          });
          const mechanics = mecsResponse.data.values || [];
          const activos = mechanics.filter(mec => mec[0] && mec[2] === 'Disponible').map(mec => mec[0]);
          return { statusCode: 200, body: JSON.stringify({ mecanicos: activos.sort() }) };
      }

      case 'get_active_paros': {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: produccionSheetId, range: 'Hoja 1!A2:N', 
        });
        const jobs = response.data.values || [];
        const activos = [];

        for (let i = 0; i < jobs.length; i++) {
            const row = i + 2;
            const [folio, , area, maquina, estacion, , statusMaquina, , , , , , mecanico, statusParo] = jobs[i];
            
            if (!statusParo || statusParo === 'Cerrado') continue;

            activos.push({
                row, folio, area, maquina, estacion, statusMaquina, mecanico, statusParo
            });
        }
        activos.sort((a, b) => {
            if (a.statusMaquina === 'detenida' && b.statusMaquina !== 'detenida') return -1;
            if (a.statusMaquina !== 'detenida' && b.statusMaquina === 'detenida') return 1;
            return a.row - b.row;
        });
        return { statusCode: 200, body: JSON.stringify({ activos }) };
      }

      // --- FUNCIONES DE ADMINISTRACIÓN & KPI ---

      case 'admin_get_dashboard': {
          const resMec = await sheets.spreadsheets.values.get({ spreadsheetId: mecanicosSheetId, range: 'Hoja 1!A2:D' });
          const mecanicos = (resMec.data.values || []).map(m => ({ name: m[0], area: m[1], active: m[2], status: m[3] }));
          
          const resJobs = await sheets.spreadsheets.values.get({ spreadsheetId: produccionSheetId, range: 'Hoja 1!A2:N' });
          const jobs = (resJobs.data.values || [])
             .map((j, i) => ({ row: i+2, folio: j[0], area: j[2], maquina: j[3], status: j[6], mecanico: j[12], estado: j[13] }))
             .filter(j => j.estado && j.estado !== 'Cerrado' && j.estado !== 'Cerrado Manual');
             
          return { statusCode: 200, body: JSON.stringify({ mecanicos, jobs }) };
      }

      case 'admin_reassign': {
          if (!row || !newMechanic) return { statusCode: 400, body: 'Faltan datos' };
          
          // 1. Leer quién tenía el trabajo antes (oldMechanic se pasa del frontend para mayor control)
          // oldMechanic se pasa como parámetro adicional del frontend
          
          // 2. Actualizar Planilla Mantenimiento (Cambiar nombre y poner Asignado)
          await sheets.spreadsheets.values.update({
              spreadsheetId: produccionSheetId,
              range: `Hoja 1!M${row}:N${row}`,
              valueInputOption: 'USER_ENTERED',
              resource: { values: [[newMechanic, 'Asignado']] }
          });

          // 3. Actualizar Estados en DB Mecánicos (Fix: Limpiar y reasignar TareaActual_RowID)
          
          // Liberar al anterior y limpiar TareaActual_RowID
          if (oldMechanic && oldMechanic !== 'En Espera') {
              const mecInfo = await findMechanicByName(sheets, oldMechanic);
              if (mecInfo) await updateMechanicStatus(sheets, mecInfo.row, 'Libre', ""); // RowID vacío
          }
          
          // Ocupar al nuevo y establecer TareaActual_RowID
          const newMecInfo = await findMechanicByName(sheets, newMechanic);
          if (newMecInfo) await updateMechanicStatus(sheets, newMecInfo.row, 'Ocupado', row); // <-- RowID de la tarea

          return { statusCode: 200, body: JSON.stringify({ message: 'Reasignado con éxito' }) };
      }

      case 'admin_cerrar_manual': {
    if (!row || !name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row" o "name" (adminName).' }) };
    
    // 1. Obtener el mecánico asignado originalmente
    const getResponse = await sheets.spreadsheets.values.get({ spreadsheetId: produccionSheetId, range: `Hoja 1!M${row}` });
    const mecanicoAsignadoOriginal = getResponse.data.values ? getResponse.data.values[0][0] : null;

    // 2. Actualizar la planilla de Mantenimiento (Columna J y Columna N)
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: produccionSheetId,
        resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
                // Columna J: Mecánico (se pone el nombre del Admin)
                { range: `Hoja 1!J${row}`, values: [[ name ]] }, 
                // Columna N: StatusParo
                { range: `Hoja 1!N${row}`, values: [['Cerrado Manual']] } 
            ]
        }
    });

    // 3. Liberar al mecánico si estaba asignado
    if (mecanicoAsignadoOriginal && mecanicoAsignadoOriginal !== 'En Espera') {
        // Ejecuta la lógica de liberación y asignación del siguiente trabajo.
        await findAndAssignNextJob(sheets, mecanicoAsignadoOriginal);
    }

    return { statusCode: 200, body: JSON.stringify({ message: 'Paro cerrado manualmente por administrador.' }) };
}

      case 'get_kpi_data': {
          // *** CORRECCIÓN CRÍTICA DE RANGO Y MAPEADO ***
          // El rango ahora incluye hasta la columna N para obtener MecanicoAsignado y StatusParo.
          const res = await sheets.spreadsheets.values.get({ spreadsheetId: produccionSheetId, range: 'Hoja 1!A2:N' });
          const data = (res.data.values || []).map(r => ({
              folio: r[0],
              apertura: r[1],
              area: r[2],
              maquina: r[3],
              estacion: r[4], // Estacion/Falla
              falla: r[7], // Falla (Col H)
              solucion: r[8], // Solucion (Col I)
              mecanico: r[9], // Mecanico (Col J)
              llegada: r[10], // Llegada (Col K)
              cierre: r[11], // Cierre (Col L)
              mecanicoAsignado: r[12], // Col M (Índice 12)
              statusParo: r[13] // Col N (Índice 13)
          }));
          return { statusCode: 200, body: JSON.stringify({ data }) };
      }

      // cambio 
      case 'get_preventive_data': {
          const spreadsheetId = '1bF9_C-4h1jESEnHZcAHEJ3PlYNCKcX-WkJ3Z8JgjIY8'; 
          const range = 'Hoja 1!A2:H'; 

          const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
          const rows = res.data.values || [];

          const data = rows.map(r => ({
              id_prev: r[0],      // A: ID
              area: r[1],         // B: Area
              activo: r[2],       // C: Activo/Maquina
              f_inicio: r[3],     // D: Fecha Inicio
              f_fin: r[4],        // E: Fecha Fin
              id_act: r[5],       // F: ID Actividad
              desc: r[6],         // G: Descripcion
              estatus: r[7]       // H: Estatus (0 o 1)
          }));

          return { statusCode: 200, body: JSON.stringify({ data }) };
      }
      // Fin cambio
      
      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Acción desconocida.` }) };
    }
  } catch (error) {
    console.error('Error fatal en la función:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error servidor: ' + error.message }) };
  }
};