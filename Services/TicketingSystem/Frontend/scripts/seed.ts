import './migrate';
import { getDb } from '../src/lib/server/db';
import { departments, affectedSystems, requestTypes, hardwareItems } from '../src/lib/server/db/schema';

const db = getDb();
db.transaction(tx => {
  tx.insert(departments).values([
    { name: 'MIS', description: 'Management Information System' }, { name: 'HR', description: 'Human Resources' },
    { name: 'Finance' }, { name: 'Accounting' },
  ]).onConflictDoNothing().run();
  const ids = new Map(tx.select().from(departments).all().map(row => [row.name, row.id]));
  tx.insert(affectedSystems).values([
    { name: 'Payroll System', department_id: ids.get('Accounting') }, { name: 'AR-NonTrade', department_id: ids.get('HR') },
    { name: 'FAST', department_id: ids.get('MIS') }, { name: 'OTC', department_id: ids.get('Accounting') },
    { name: 'IBS', department_id: ids.get('MIS') }, { name: 'Others' },
  ]).onConflictDoNothing().run();
  tx.insert(requestTypes).values([
    { name: 'Bug Report', department_id: ids.get('MIS') },
    { name: 'Feature Request', department_id: ids.get('MIS'), requires_approval_by_default: true },
    { name: 'Access Request', department_id: ids.get('MIS'), requires_approval_by_default: true },
    { name: 'Hardware Issue', department_id: ids.get('MIS') },
    { name: 'Software Installation', department_id: ids.get('MIS') }, { name: 'Others' },
  ]).onConflictDoNothing().run();
  tx.insert(hardwareItems).values(['Printer', 'Monitor', 'Desktop', 'Laptop', 'Others'].map(name => ({ name }))).onConflictDoNothing().run();
});
console.log('Reference data ready; existing records preserved.');
db.$client.close();
