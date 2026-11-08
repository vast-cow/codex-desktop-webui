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
  simple(ast, { ClassDeclaration(node: any) {
    if (node.id.name === className) constructor = node.body.body.find((member: any) => member.kind === 'constructor')?.value;
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
  return { exportName, className, services };
}
