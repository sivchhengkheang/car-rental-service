"use client";

const CATEGORIES = [
  { id: "ALL", label: "All Vehicles", icon: "✨" },
  { id: "Sedan", label: "Sedans", icon: "🚗" },
  { id: "SUV", label: "SUVs & 4x4", icon: "🚙" },
  { id: "Luxury", label: "Luxury & VIP", icon: "👑" },
  { id: "Electric", label: "Electric & Hybrid", icon: "⚡" },
  { id: "Truck", label: "Pickups", icon: "🛻" },
  { id: "Van", label: "Vans & MPVs", icon: "🚐" },
  { id: "Automatic", label: "Automatic Only", icon: "🕹️" },
];

export default function CategoryBar({ activeCategory, onSelectCategory }) {
  return (
    <div className="sticky top-14 sm:top-16 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90 py-1.5 sm:py-2 transition-all">
      <div className="w-full px-3 sm:px-8 lg:px-12 xl:px-16 max-w-[1920px] mx-auto">
        <div className="flex items-center gap-4 sm:gap-7 overflow-x-auto scrollbar-none py-0.5 touch-pan-x">
          {CATEGORIES.map((cat) => {
            const isActive = (activeCategory || "ALL") === cat.id;
            return (
              <button
                key={cat.id}
                className={`flex flex-col items-center gap-0.5 sm:gap-1 bg-transparent border-b-2 cursor-pointer whitespace-nowrap pb-1.5 sm:pb-2 transition-all shrink-0 ${
                  isActive
                    ? "text-blue-700 border-blue-600 opacity-100 font-bold"
                    : "text-slate-500 border-transparent hover:text-slate-900 hover:border-slate-300 opacity-75"
                }`}
                onClick={() => onSelectCategory && onSelectCategory(cat.id)}
              >
                <span className="text-base sm:text-xl transition-transform hover:-translate-y-0.5">
                  {cat.icon}
                </span>
                <span className="text-[10px] sm:text-xs font-semibold">{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
