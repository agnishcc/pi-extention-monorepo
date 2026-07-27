import React, { useState } from 'react';

interface ProviderLogoProps {
  logo?: string;
  name?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_MAP = {
  sm: 'w-5 h-5 p-0.5',
  md: 'w-7 h-7 p-1',
  lg: 'w-9 h-9 p-1.5',
};

export const ProviderLogo: React.FC<ProviderLogoProps> = ({
  logo,
  name = 'Provider',
  className = '',
  size = 'md',
}) => {
  const [error, setError] = useState(false);

  return (
    <div
      className={`rounded-md bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-sm overflow-hidden ${SIZE_MAP[size]} ${className}`}
    >
      {!error && logo ? (
        <img
          src={logo}
          alt={name}
          onError={() => setError(true)}
          className="w-full h-full object-contain filter brightness-95 contrast-125"
        />
      ) : (
        <span className="text-[10px] font-extrabold text-slate-900 font-mono uppercase tracking-tight">
          {name.slice(0, 2)}
        </span>
      )}
    </div>
  );
};
