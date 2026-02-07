import { useEditor, useSelectedEntity, useEntities } from "./useEditor";

export function EntityTree() {
  const { world, hierarchy, store } = useEditor();
  const selectedEntity = useSelectedEntity();
  // Subscribe to entity changes so tree re-renders when entities change
  useEntities();

  const entities: number[] = [];
  world.forEachEntity((e) => entities.push(e));

  // Build root entities (no parent)
  const roots = entities.filter((e) => hierarchy.getParent(e) === undefined);

  function renderEntity(entity: number, depth: number) {
    const children = hierarchy.getChildren(entity);
    const isSelected = entity === selectedEntity;
    const components: string[] = [];
    for (const type of Object.keys(world.registry) as Array<keyof typeof world.registry>) {
      if (world.hasComponent(entity, type)) {
        components.push(type);
      }
    }

    return (
      <div key={entity}>
        <button
          onClick={() => store.selectEntity(entity)}
          className={`w-full text-left px-2 py-1 flex items-center gap-1.5 hover:bg-surface cursor-pointer ${
            isSelected ? "bg-selected" : ""
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          <span className="text-muted text-[10px] shrink-0">
            {entity}
          </span>
          <span className="truncate">
            Entity {entity}
          </span>
          <span className="ml-auto flex gap-0.5 shrink-0">
            {components.map((c) => (
              <span
                key={c}
                className="bg-subtle text-muted px-1 rounded text-[9px]"
              >
                {c}
              </span>
            ))}
          </span>
        </button>
        {children.map((child) => renderEntity(child as number, depth + 1))}
      </div>
    );
  }

  return (
    <div>
      <div className="px-2 py-1.5 text-muted font-medium uppercase tracking-wider text-[10px] border-b border-subtle">
        Entities
      </div>
      {roots.map((entity) => renderEntity(entity, 0))}
    </div>
  );
}
