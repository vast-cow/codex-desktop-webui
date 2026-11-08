import { parse } from 'acorn';
import { simple } from 'acorn-walk';

/** Inspect inert factory syntax; never execute vendor startup to discover services. */
export function managerContract(source: string, exportName = 'O3') {
  const ast = parse(`(${source})`, { ecmaVersion: 'latest' });
  let className: string | undefined;
  simple(ast, { Property(node: any) {
    if ((node.key.name ?? node.key.value) === exportName && node.value.type === 'ArrowFunctionExpression' && node.value.body.type === 'Identifier') {
      className = node.value.body.name;
    }
  }});
  if (!className) throw Error(`Cannot locate manager export ${exportName}`);
  let constructor: any;
  let manager: any;
  simple(ast, { ClassDeclaration(node: any) {
    if (node.id.name === className) {
      manager = node;
      constructor = node.body.body.find((member: any) => member.kind === 'constructor')?.value;
    }
  }});
  if (!constructor || constructor.params[0]?.type !== 'Identifier') throw Error('Unsupported manager constructor');
  const parameter = constructor.params[0].name;
  const services: { name: string; defaulted: boolean }[] = [];
  simple(constructor.body, { VariableDeclarator(node: any) {
    if (node.init?.type !== 'Identifier' || node.init.name !== parameter || node.id.type !== 'ObjectPattern') return;
    for (const property of node.id.properties) {
      if (property.type !== 'Property') throw Error('Unsupported constructor service binding');
      services.push({ name: property.key.name ?? property.key.value, defaulted: property.value.type === 'AssignmentPattern' });
    }
  }});
  if (!services.length) throw Error('No manager services found');
  // Inventory direct stored-service paths only. Helpers and aliases need separate
  // tracing; this deliberately makes no claim to a complete runtime contract.
  const paths = new Map(services.map(service => [service.name, new Set<string>()]));
  simple(manager, { MemberExpression(node: any) {
    const parts: string[] = [];
    let current = node;
    while (current.type === 'MemberExpression') {
      const key = current.computed ? current.property.value : current.property.name;
      if (typeof key !== 'string') return;
      parts.unshift(key);
      current = current.object;
    }
    if (current.type === 'ThisExpression' && parts.length > 1) {
      paths.get(parts[0])?.add(parts.slice(1).join('.'));
    }
  }});
  const storedServicePaths = Object.fromEntries([...paths]
    .filter(([, members]) => members.size)
    .map(([name, members]) => [name, [...members].sort()]));
  return { exportName, className, services, storedServicePaths };
}
