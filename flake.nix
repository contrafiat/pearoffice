{
  description = "PearOffice: peer-to-peer spreadsheets, documents and slides";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  # The package is the released .deb (nixos/pearoffice.nix). scripts/release.sh
  # sets its version and hash on every release, so following this flake picks up
  # new versions. In-app updates are off in this build; Nix does the updating.
  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      packages.${system} = {
        pearoffice = pkgs.callPackage ./nixos/pearoffice.nix { };
        default = self.packages.${system}.pearoffice;
      };
      overlays.default = final: prev: {
        pearoffice = final.callPackage ./nixos/pearoffice.nix { };
      };
    };
}
