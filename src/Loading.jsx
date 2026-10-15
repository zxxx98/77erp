import React from 'react';
import './loading.css';

export function LoadingIndicator({ size = 24 }) {
  return <img className="loading-indicator" src={`${import.meta.env.BASE_URL}77-erp-loading.svg`} width={size} height={size} alt="" aria-hidden="true" />;
}

export function LoadingStatus({ children, size = 24 }) {
  return <span className="loading-status" role="status"><LoadingIndicator size={size} /><span>{children}</span></span>;
}
