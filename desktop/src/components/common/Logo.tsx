import troveLogoImg from "../../assets/logo.png";

interface TroveLogoProps {
  className?: string;
  size?: number;
}

export function TroveLogo({ className = "h-8 w-8", size }: TroveLogoProps) {
  return (
    <img
      src={troveLogoImg}
      alt="Trove"
      onError={(e) => {
        // Fallback to relative public asset if bundled path fails
        if (e.currentTarget.src !== "./logo.png") {
          e.currentTarget.src = "./logo.png";
        }
      }}
      style={size ? { width: size, height: size } : undefined}
      className={`object-contain select-none drop-shadow-md shrink-0 ${className}`}
      draggable={false}
    />
  );
}

export default TroveLogo;
